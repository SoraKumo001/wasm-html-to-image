// Generates `dist/html-to-image-wasm.js`: the WASM binary compressed
// with gzip (level 9) and inlined as base64, so the browser worker bundle
// (`dist/web-workers.js`) embeds ~5MB instead of the 12MB SINGLE_FILE
// glue. Plain Node, no dependencies beyond the compiled `wasm-binary.js`.
//
// Usage (from `packages/html-to-image/`):
//   node scripts/compress-wasm.mjs
//
// Hardening for builds that overlap with another build (ninja/emcc
// rewriting `dist/html-to-image.wasm`, or rolldown/tests importing this
// payload while it is regenerated):
//
// 1. `readStableWasm` reads the `.wasm` only once its size/mtime are
//    unchanged across the read *and* `checkWasmBinary` accepts it, so a
//    half-written binary is never compressed into the payload.
// 2. `writeFileAtomic` writes to a temp file in the same directory and
//    renames it over the destination, so a reader sees either the previous
//    complete payload or the new one — never a partial file. Windows cannot
//    always rename over an open destination, so that case falls back to
//    remove → rename (readers then see ENOENT for an instant, never a
//    truncated file).
// 3. `verifyGenerationPair` checks that `dist/html-to-image.js` (glue) and
//    `dist/html-to-image.wasm` come from the same build: the glue's import
//    namespaces/fields and the export names it reads from `wasmExports`
//    must all exist in the binary. A stale pair fails `pnpm build` instead
//    of surfacing as `Import #0 "env" is not an object` at runtime.
//    Set `WASM_SKIP_GENERATION_CHECK=1` to bypass it (offline analysis of a
//    partially rebuilt tree only).
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = join(root, "dist", "html-to-image.wasm");
const gluePath = join(root, "dist", "html-to-image.js");
const outPath = join(root, "dist", "html-to-image-wasm.js");

/** How often the `.wasm` read is retried while another process writes it. */
const READ_ATTEMPTS = 20;

/** Delay between `.wasm` read attempts (ms). */
const READ_RETRY_DELAY_MS = 50;

/** How often the atomic rename is retried before the remove → rename fallback. */
const RENAME_ATTEMPTS = 4;

/** Delay between rename attempts (ms, multiplied by the attempt number). */
const RENAME_RETRY_DELAY_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Byte-wise equality of two byte arrays. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Load the compiled structural checker (`tsc -b` output). */
async function loadWasmChecker() {
  try {
    const mod = await import("../dist/wasm-binary.js");
    return mod.checkWasmBinary;
  } catch (e) {
    throw new Error(
      "scripts/compress-wasm.mjs: cannot load dist/wasm-binary.js " +
        `(${e instanceof Error ? e.message : String(e)}). ` +
        "Run `tsc -b` first — `pnpm build` does that automatically.",
    );
  }
}

/**
 * Read `path` once and report the stat before/after, so the caller can tell
 * whether the file changed underneath the read.
 */
function readBytesWithStat(path) {
  const before = statSync(path, { bigint: true });
  const bytes = new Uint8Array(readFileSync(path));
  const after = statSync(path, { bigint: true });
  return { before, after, bytes };
}

/**
 * Read a `.wasm` that ninja/emcc may still be writing.
 *
 * A read is accepted only when the file did not change while it was read
 * and the bytes form a structurally complete module. Otherwise the read is
 * retried for a short while (a link step rewrites the file in place) and
 * the last reason is reported when it never settles.
 */
async function readStableWasm(path, checkWasmBinary) {
  let lastReason = "unknown";
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    let read;
    try {
      read = readBytesWithStat(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      lastReason = "file disappeared (being replaced)";
      await sleep(READ_RETRY_DELAY_MS);
      continue;
    }
    const { before, after, bytes } = read;
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      BigInt(bytes.length) !== after.size
    ) {
      lastReason =
        `changed while reading (${before.size} -> ${after.size} bytes)`;
      await sleep(READ_RETRY_DELAY_MS);
      continue;
    }
    const check = checkWasmBinary(bytes);
    if (!check.ok) {
      lastReason = `incomplete module: ${check.reason}`;
      await sleep(READ_RETRY_DELAY_MS);
      continue;
    }
    if (attempt > 1) {
      console.log(
        `compress-wasm: wasm settled after ${attempt} attempts ` +
          `(previous: ${lastReason})`,
      );
    }
    return { bytes, stat: after };
  }
  throw new Error(
    `scripts/compress-wasm.mjs: ${basename(path)} did not settle after ` +
      `${READ_ATTEMPTS} attempts (${READ_ATTEMPTS * READ_RETRY_DELAY_MS} ms): ` +
      `${lastReason}. Is another build (ninja/emcc) still writing it?`,
  );
}

/** Read an unsigned LEB128 value; `null` when truncated/malformed. */
function readU32Leb(bytes, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) return null;
  }
  return { value: result, next: pos };
}

/** Read a length-prefixed UTF-8-ish name; `null` when truncated. */
function readName(bytes, offset) {
  const len = readU32Leb(bytes, offset);
  if (!len) return null;
  const start = len.next;
  const end = start + len.value;
  if (end > bytes.length) return null;
  return {
    value: Buffer.from(bytes.subarray(start, end)).toString("latin1"),
    next: end,
  };
}

/**
 * Import module/field pairs and export names of a WASM binary.
 *
 * Used to check that the glue and the binary are a matched pair: the glue
 * must supply every import the binary asks for and must only read exports
 * the binary actually provides.
 */
function parseWasmSignature(bytes) {
  const imports = [];
  const exports = [];
  let off = 8; // magic + version (already validated by checkWasmBinary)
  while (off < bytes.length) {
    const id = bytes[off++];
    const size = readU32Leb(bytes, off);
    if (!size) break;
    off = size.next;
    const end = off + size.value;
    if (end > bytes.length) break;
    if (id === 2) {
      const count = readU32Leb(bytes, off);
      if (count) {
        let p = count.next;
        for (let i = 0; i < count.value; i++) {
          const mod = readName(bytes, p);
          if (!mod) break;
          const field = readName(bytes, mod.next);
          if (!field) break;
          imports.push({ module: mod.value, field: field.value });
          p = field.next;
          const kind = bytes[p++];
          if (kind === undefined) break;
          if (kind === 0) {
            const typeIdx = readU32Leb(bytes, p);
            if (!typeIdx) break;
            p = typeIdx.next;
          } else if (kind === 1 || kind === 2) {
            p += 1; // element/value type
            const flags = bytes[p++];
            if (flags === undefined) break;
            const min = readU32Leb(bytes, p);
            if (!min) break;
            p = min.next;
            if (flags & 0x01) {
              const max = readU32Leb(bytes, p);
              if (!max) break;
              p = max.next;
            }
          } else if (kind === 3) {
            p += 2; // value type + mutability
          } else if (kind === 4) {
            const attr = bytes[p++];
            if (attr === undefined) break;
            const typeIdx = readU32Leb(bytes, p);
            if (!typeIdx) break;
            p = typeIdx.next;
          } else {
            break; // unknown kind: stop parsing imports
          }
        }
      }
    } else if (id === 7) {
      const count = readU32Leb(bytes, off);
      if (count) {
        let p = count.next;
        for (let i = 0; i < count.value; i++) {
          const name = readName(bytes, p);
          if (!name) break;
          exports.push(name.value);
          p = name.next + 1; // kind byte
          const idx = readU32Leb(bytes, p);
          if (!idx) break;
          p = idx.next;
        }
      }
    }
    off = end;
  }
  return { imports, exports };
}

/** Index just past the quote closing the string literal starting at `start`. */
function skipString(src, start) {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === quote) return i;
  }
  return src.length;
}

/** Index just past the `}` matching the `{` at `open` (string-aware). */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Skip a value expression up to the next top-level `,` (or the end). */
function skipValue(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "," && depth === 0) return i;
  }
  return src.length;
}

/** Top-level `key: value` entries of an object literal body (no braces). */
function topLevelEntries(body) {
  const entries = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    let key;
    if (body[i] === '"' || body[i] === "'" || body[i] === "`") {
      const end = skipString(body, i);
      key = body.slice(i + 1, end);
      i = end + 1;
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(body.slice(i));
      if (!m) break;
      key = m[0];
      i += key.length;
    }
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== ":") {
      // Shorthand / unexpected token: skip it.
      i = skipValue(body, i) + 1;
      continue;
    }
    i++;
    const valueEnd = skipValue(body, i);
    entries.push({ key, value: body.slice(i, valueEnd).trim() });
    i = valueEnd + 1;
  }
  return entries;
}

/**
 * What the glue expects from the binary: the import object shape and the
 * export names it reads via `wasmExports[...]`.
 */
function analyzeGlue(glue) {
  const info = {
    /** Import namespaces supplied by the glue (null when not detectable). */
    namespaces: null,
    /** Per-namespace import field names (null for the flat/minified form). */
    fieldsByNamespace: null,
    /** Import field names for the flat (`{a: wasmImports}`) form. */
    flatFields: null,
    /** Export names the glue reads from the instance. */
    exportRefs: new Set(),
    /** `.wasm` file name the glue looks for. */
    wasmFile: null,
  };

  const fileMatch = /locateFile\(\s*"([^"]+\.wasm)"\s*\)/.exec(glue);
  if (fileMatch) info.wasmFile = fileMatch[1];

  for (const m of glue.matchAll(/wasmExports\[\s*["']([^"']+)["']\s*\]/g)) {
    info.exportRefs.add(m[1]);
  }
  for (const m of glue.matchAll(/\bwasmExports\.([A-Za-z_$][\w$]*)/g)) {
    info.exportRefs.add(m[1]);
  }

  const decl = /var\s+wasmImports\s*=\s*/.exec(glue);
  if (!decl) return info;
  const open = glue.indexOf("{", decl.index + decl[0].length);
  const close = open < 0 ? -1 : matchBrace(glue, open);
  if (close < 0) return info;
  const entries = topLevelEntries(glue.slice(open + 1, close - 1));

  if (entries.some((e) => e.value.startsWith("{"))) {
    // Unminified form: `{ env: { ... }, wasi_snapshot_preview1: { ... } }`.
    info.namespaces = entries.map((e) => e.key);
    info.fieldsByNamespace = new Map(
      entries
        .filter((e) => e.value.startsWith("{"))
        .map((e) => [
          e.key,
          topLevelEntries(e.value.slice(1, -1)).map((x) => x.key),
        ]),
    );
    return info;
  }

  // Minified form: `var wasmImports = { a: __import, b: __import, ... }`
  // wrapped by `var imports = { a: wasmImports }` in `getWasmImports`.
  info.flatFields = entries.map((e) => e.key);
  const wrapper =
    /\{\s*((?:["']?[A-Za-z_$][\w$]*["']?\s*:\s*wasmImports\s*,?\s*)+)\}/.exec(
      glue,
    );
  if (wrapper) {
    info.namespaces = wrapper[1]
      .split(",")
      .map((part) => part.split(":")[0].replace(/["']/g, "").trim())
      .filter(Boolean);
  }
  return info;
}

/**
 * Problem descriptions when the glue and the binary are not the same
 * generation (empty array when they match).
 */
function verifyGenerationPair(glue, signature, wasmFileName) {
  const info = analyzeGlue(glue);
  const problems = [];

  if (info.wasmFile && info.wasmFile !== wasmFileName) {
    problems.push(
      `glue loads "${info.wasmFile}" but the binary is "${wasmFileName}"`,
    );
  }

  const modules = new Set(signature.imports.map((i) => i.module));
  if (info.namespaces) {
    for (const module of modules) {
      if (!info.namespaces.includes(module)) {
        problems.push(
          `binary imports namespace "${module}" but the glue only supplies ` +
            `{${info.namespaces.join(", ")}}`,
        );
      }
    }
  }

  for (const { module, field } of signature.imports) {
    const known =
      info.fieldsByNamespace?.get(module) ?? info.flatFields ?? null;
    if (!known) continue;
    if (!known.includes(field)) {
      problems.push(
        `binary imports "${module}"."${field}" but the glue does not define it`,
      );
    }
  }

  const exportNames = new Set(signature.exports);
  for (const ref of info.exportRefs) {
    if (!exportNames.has(ref)) {
      problems.push(
        `glue reads wasmExports["${ref}"] but the binary does not export it`,
      );
    }
  }

  return problems;
}

/**
 * Write `data` to `path` without ever exposing a partially written file:
 * write a temp file next to the target, then rename it into place.
 *
 * Windows refuses `rename` over a destination another process holds open
 * (EPERM/EACCES/EBUSY); the minimal fallback is remove → rename, which
 * leaves a tiny ENOENT window instead of a truncated file.
 */
async function writeFileAtomic(path, data) {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  const fd = openSync(tmp, "wx");
  try {
    writeFileSync(fd, data);
    // Flush before the rename so a crash cannot leave an empty payload
    // behind a valid-looking name.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  const removeTmp = () => {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort: the process is about to fail anyway */
    }
  };

  const retryable = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      if (!retryable.has(e.code)) {
        removeTmp();
        throw e;
      }
      if (attempt < RENAME_ATTEMPTS) {
        await sleep(RENAME_RETRY_DELAY_MS * attempt);
        continue;
      }
      try {
        unlinkSync(path);
      } catch (e2) {
        if (e2.code !== "ENOENT") {
          removeTmp();
          throw new Error(
            `scripts/compress-wasm.mjs: cannot replace ${basename(
              path,
            )}: rename failed (${e.code}) and remove failed (${e2.code})`,
          );
        }
      }
      try {
        renameSync(tmp, path);
        return;
      } catch (e3) {
        removeTmp();
        throw e3;
      }
    }
  }
}

async function main() {
  const checkWasmBinary = await loadWasmChecker();

  // Read + compress, then confirm the source did not change while it was
  // compressed: otherwise the payload would be one generation older than
  // the glue the same build just installed.
  let bytes;
  let gz;
  let base64;
  let sha256;
  for (let attempt = 1; ; attempt++) {
    const { bytes: read, stat } = await readStableWasm(
      wasmPath,
      checkWasmBinary,
    );
    const compressed = gzipSync(read, { level: 9 });
    const after = statSync(wasmPath, { bigint: true });
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) {
      // The file was rewritten while we compressed it. A relink of unchanged
      // sources rewrites identical bytes: accept those, retry a different
      // generation, and give up when the file never stops moving.
      let current;
      try {
        current = new Uint8Array(readFileSync(wasmPath));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        current = null;
      }
      if (!current || !sameBytes(read, current)) {
        if (attempt >= 3) {
          throw new Error(
            `scripts/compress-wasm.mjs: ${basename(
              wasmPath,
            )} kept changing while it was compressed; refusing to write a ` +
              "payload that may not match the glue. Retry once the WASM build is idle.",
          );
        }
        continue;
      }
    }
    bytes = read;
    gz = compressed;
    base64 = compressed.toString("base64");
    sha256 = createHash("sha256").update(read).digest("hex");
    break;
  }

  // NOTE: gzip only — `DecompressionStream` (W3C Compression Standard)
  // accepts only "gzip"/"deflate"/"deflate-raw"; "br" is rejected by both
  // browsers and Node (`not a valid enum value of type CompressionFormat`),
  // so a brotli payload could never be restored at runtime.
  const encoding = "gzip";

  let generationChecked = false;
  if (process.env.WASM_SKIP_GENERATION_CHECK !== "1") {
    if (!existsSync(gluePath)) {
      console.warn(
        `compress-wasm: ${basename(gluePath)} is missing; skipping the ` +
          "glue/binary generation check",
      );
    } else {
      const problems = verifyGenerationPair(
        readFileSync(gluePath, "utf8"),
        parseWasmSignature(bytes),
        basename(wasmPath),
      );
      if (problems.length > 0) {
        throw new Error(
          "scripts/compress-wasm.mjs: glue/binary generation mismatch " +
            `(${basename(gluePath)} vs ${basename(wasmPath)}):\n` +
            problems.map((p) => `  - ${p}`).join("\n") +
            "\nRebuild both (`pnpm wasm:build`) so the pair comes from one link.",
        );
      }
      generationChecked = true;
    }
  }

  const payload =
    `// Generated by scripts/compress-wasm.mjs — do not edit.\n` +
    `export const wasmEncoding = ${JSON.stringify(encoding)};\n` +
    `export const wasmSize = ${bytes.length};\n` +
    `export const wasmSha256 = ${JSON.stringify(sha256)};\n` +
    `export const wasmBase64 = ${JSON.stringify(base64)};\n`;

  await writeFileAtomic(outPath, payload);

  console.log(
    `raw=${bytes.length} gzip=${gz.length} ` +
      `base64=${base64.length} encoding=${encoding} ` +
      `sha256=${sha256.slice(0, 12)}… ` +
      `generation=${generationChecked ? "ok" : "skipped"} -> ` +
      "dist/html-to-image-wasm.js",
  );
}

await main();
