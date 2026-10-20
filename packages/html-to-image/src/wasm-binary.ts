/**
 * Minimal WASM binary sanity check.
 *
 * The loader hands the `.wasm` bytes straight to the engine, so a file
 * that is still being written (concurrent build) or that belongs to a
 * different build than the JavaScript glue fails deep inside V8 with
 * messages that do not point at the real cause:
 *
 * - `CompileError: section Data extends past end` — the file was read
 *   while it was still being written (truncated binary).
 * - `Import #0 "env" is not an object` — the binary and the glue come
 *   from different builds (the import namespace does not match).
 *
 * {@link checkWasmBinary} detects the truncated case before the engine
 * sees it and reports the import namespaces, so the loader can explain
 * a mismatch instead of surfacing a cryptic engine error.
 */

/** Result of {@link checkWasmBinary}. */
export interface WasmBinaryCheck {
  /** True when the bytes are a structurally complete WASM binary. */
  ok: boolean;
  /** Why the check failed (only set when `ok` is false). */
  reason?: string;
  /** Import namespaces (module names) the binary requires. */
  namespaces: string[];
}

/** WASM magic header (`\0asm`). */
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/** Section id of the import section. */
const SECTION_IMPORT = 2;

/** Human-readable section names (for the failure reason). */
const SECTION_NAMES: Record<number, string> = {
  0: "Custom",
  1: "Type",
  2: "Import",
  3: "Function",
  4: "Table",
  5: "Memory",
  6: "Global",
  7: "Export",
  8: "Start",
  9: "Element",
  10: "Code",
  11: "Data",
  12: "DataCount",
  13: "Tag",
};

/** Read an unsigned LEB128 value; returns `null` when malformed. */
function readU32Leb(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) return null; // malformed / truncated
  }
  return { value: result, next: pos };
}

/** Read a length-prefixed name; returns `null` when malformed. */
function readName(
  bytes: Uint8Array,
  offset: number,
): { value: string; next: number } | null {
  const len = readU32Leb(bytes, offset);
  if (!len) return null;
  const start = len.next;
  const end = start + len.value;
  if (end > bytes.length) return null;
  let name = "";
  for (let i = start; i < end; i++) name += String.fromCharCode(bytes[i]);
  return { value: name, next: end };
}

/**
 * Collect the import namespaces (module names) of an import section.
 * Malformed input simply yields no namespaces (the caller reports the
 * structural problem separately).
 */
function collectImportNamespaces(
  section: Uint8Array,
  namespaces: string[],
): void {
  const count = readU32Leb(section, 0);
  if (!count) return;
  let off = count.next;
  for (let i = 0; i < count.value; i++) {
    const mod = readName(section, off);
    if (!mod) return;
    const field = readName(section, mod.next);
    if (!field) return;
    off = field.next;
    const kind = section[off++];
    if (kind === undefined) return;
    // Skip the kind-specific descriptor.
    if (kind === 0) {
      const typeIdx = readU32Leb(section, off);
      if (!typeIdx) return;
      off = typeIdx.next;
    } else if (kind === 1) {
      off += 1; // element type
      const flags = section[off++];
      if (flags === undefined) return;
      const min = readU32Leb(section, off);
      if (!min) return;
      off = min.next;
      if (flags & 0x01) {
        const max = readU32Leb(section, off);
        if (!max) return;
        off = max.next;
      }
    } else if (kind === 2) {
      const flags = section[off++];
      if (flags === undefined) return;
      const min = readU32Leb(section, off);
      if (!min) return;
      off = min.next;
      if (flags & 0x01) {
        const max = readU32Leb(section, off);
        if (!max) return;
        off = max.next;
      }
    } else if (kind === 3) {
      off += 2; // value type + mutability
    } else if (kind === 4) {
      const attr = section[off++];
      if (attr === undefined) return;
      const typeIdx = readU32Leb(section, off);
      if (!typeIdx) return;
      off = typeIdx.next;
    } else {
      return; // unknown kind: stop parsing
    }
    if (!namespaces.includes(mod.value)) namespaces.push(mod.value);
  }
}

/**
 * Check that `bytes` is a structurally complete WASM binary.
 *
 * Walks the section table: a truncated file (the classic symptom of
 * reading a file that is still being written) shows up as a section
 * whose declared length runs past the end of the buffer.
 */
export function checkWasmBinary(bytes: Uint8Array): WasmBinaryCheck {
  const namespaces: string[] = [];
  if (bytes.length < 8) {
    return {
      ok: false,
      reason: `too short to be a WebAssembly binary (${bytes.length} bytes)`,
      namespaces,
    };
  }
  for (let i = 0; i < WASM_MAGIC.length; i++) {
    if (bytes[i] !== WASM_MAGIC[i]) {
      return {
        ok: false,
        reason: "not a WebAssembly binary (bad magic header)",
        namespaces,
      };
    }
  }
  const version =
    bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (version !== 1) {
    return {
      ok: false,
      reason: `unsupported WebAssembly version ${version >>> 0}`,
      namespaces,
    };
  }
  let off = 8;
  while (off < bytes.length) {
    const id = bytes[off++];
    const size = readU32Leb(bytes, off);
    if (!size) {
      return {
        ok: false,
        reason: "malformed section header (truncated binary)",
        namespaces,
      };
    }
    off = size.next;
    const end = off + size.value;
    if (end > bytes.length) {
      const name = SECTION_NAMES[id] ?? `#${id}`;
      return {
        ok: false,
        reason:
          `section ${name} extends past end of the module ` +
          `(length ${size.value}, remaining bytes ${bytes.length - off})`,
        namespaces,
      };
    }
    if (id === SECTION_IMPORT) {
      collectImportNamespaces(bytes.subarray(off, end), namespaces);
    }
    off = end;
  }
  return { ok: true, namespaces };
}
