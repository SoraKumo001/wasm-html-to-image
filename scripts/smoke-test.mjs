// Single-WASM smoke test (reproducible).
// Usage: node scripts/smoke-test.mjs [test-image-path]
// Loads packages/html-to-image/dist/html-to-image.js (+ .wasm) and checks:
//   a. converter_encode (test image -> webp/png, magic RIFF/89PNG)
// Loads packages/html-to-image/dist/single.js (TS facade) and checks:
//   e. render({ value: html, format: png }) -> 89PNG (HTML unified path)
//   f. render({ value: jpgBytes, format: svg }) -> svg string with <image>
//   g. render({ value: jpgBytes, format: pdf }) -> %PDF magic
//   h. avif roundtrip: jpg -> avif (ftyp) -> png (89PNG)
//   i. animated gif -> animated webp (ANMF preserved)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDir = path.join(repoRoot, "packages", "html-to-image", "dist");
const glueJs = path.join(distDir, "html-to-image.js");
const wasmPath = path.join(distDir, "html-to-image.wasm");
const defaultImg = path.join(
  repoRoot,
  "packages",
  "visual-test",
  "assets",
  "images",
  "image01.jpg",
);
const imgPath = process.argv[2] ?? defaultImg;

// RenderFormat enum (mirrors bridge_types.h / wasm-image-optimization core.ts)
const FMT = {
  SVG: 0,
  PNG: 1,
  WebP: 2,
  PDF: 3,
  JPEG: 4,
  AVIF: 5,
  RAW: 6,
  ThumbHash: 7,
};

const results = {
  a: "SKIP",
  e: "SKIP",
  f: "SKIP",
  g: "SKIP",
  h: "SKIP",
  i: "SKIP",
};
const details = {};

const mod = await (
  await import(pathToFileURL(glueJs).href)
).default({ wasmBinary: fs.readFileSync(wasmPath) });
console.log(
  `loaded html-to-image.js keys: ${Object.keys(mod)
    .filter((k) => /satoru|converter|html_to_image/.test(k))
    .join(",")}`,
);

// ---- a. converter roundtrip (load_image -> encode webp -> crop -> encode png) ----
try {
  const jpg = fs.readFileSync(imgPath);
  details.a_input = `${path.basename(imgPath)} len=${jpg.length} head=${Buffer.from(jpg.subarray(0, 4)).toString("hex")}`;
  const ci = mod.converter_create_instance();
  const steps = [];
  try {
    const loaded = mod.converter_load_image(ci, jpg);
    steps.push(`load=${loaded}`);
    if (!loaded) throw new Error("converter_load_image => false");
    steps.push(
      `orig=${mod.converter_get_original_width(ci)}x${mod.converter_get_original_height(ci)} ${mod.converter_get_original_format(ci)}`,
    );
    const webp = mod.converter_encode(ci, FMT.WebP, 80, 6, false);
    if (webp === null || webp === undefined)
      throw new Error("converter_encode(webp) => null");
    const wb = Buffer.from(webp);
    if (wb.subarray(0, 4).toString("latin1") !== "RIFF") {
      throw new Error(
        `webp magic mismatch: ${wb.subarray(0, 8).toString("hex")}`,
      );
    }
    steps.push(`webp len=${wb.length} magic=RIFF(webp)`);
    const cropped = mod.converter_crop(ci, 0, 0, 8, 8);
    steps.push(
      `crop=${cropped} size=${mod.converter_get_width(ci)}x${mod.converter_get_height(ci)}`,
    );
    if (!cropped) throw new Error("converter_crop => false");
    const png = mod.converter_encode(ci, FMT.PNG, 0, 0, false);
    if (png === null || png === undefined)
      throw new Error("converter_encode(png) => null");
    const pb = Buffer.from(png);
    if (!pb.subarray(0, 4).toString("hex").startsWith("89504e47")) {
      throw new Error(
        `png magic mismatch: ${pb.subarray(0, 8).toString("hex")}`,
      );
    }
    steps.push(`png len=${pb.length} magic=89PNG`);
    results.a = "PASS";
    details.a_encode = steps.join(" | ");
  } catch (e) {
    results.a = "FAIL";
    details.a_encode = `${steps.join(" | ")} || ${String(e?.message ?? e).slice(0, 300)}`;
  }
  try {
    mod.converter_destroy_instance(ci);
  } catch {}
} catch (e) {
  results.a = "FAIL";
  details.a_encode = `harness error: ${String(e?.message ?? e).slice(0, 300)}`;
}

console.log(JSON.stringify({ results, details, imgPath }, null, 2));
console.log(
  `a(converter_encode): ${results.a} -- ${details.a_input ?? ""} | ${details.a_encode ?? ""}`,
);

// ---- e/f/g/h/i. TS facade (dist/single.js render: unified htmlToImage) ----
try {
  const facadeUrl = pathToFileURL(
    path.join(repoRoot, "packages", "html-to-image", "dist", "single.js"),
  ).href;
  const { render } = await import(facadeUrl);
  // e. HTML input -> png
  try {
    const res = await render({
      value: "<h1>hi</h1>",
      width: 800,
      height: 600,
      format: "png",
    });
    const out = res.data;
    if (
      !(out instanceof Uint8Array) ||
      !Buffer.from(out.subarray(0, 4)).toString("hex").startsWith("89504e47") ||
      res.width !== 800
    ) {
      throw new Error(
        `png magic/metadata mismatch: len=${out?.length} w=${res.width}`,
      );
    }
    results.e = "PASS";
    details.e_html = `html->png len=${out.length} magic=89PNG size=${res.width}x${res.height}`;
  } catch (e) {
    results.e = "FAIL";
    details.e_html = String(e?.message ?? e).slice(0, 300);
  }
  // f. image input -> svg string with <image>
  try {
    const jpg = fs.readFileSync(imgPath);
    const res = await render({
      value: new Uint8Array(jpg),
      width: 800,
      format: "svg",
    });
    const out = res.data;
    if (
      typeof out !== "string" ||
      !out.includes("<svg") ||
      !out.includes("<image")
    ) {
      throw new Error(
        `svg shape mismatch: type=${typeof out} len=${out?.length}`,
      );
    }
    results.f = "PASS";
    details.f_imgsvg = `jpg->svg len=${out.length} has <svg>+<image>`;
  } catch (e) {
    results.f = "FAIL";
    details.f_imgsvg = String(e?.message ?? e).slice(0, 300);
  }
  // g. image input -> pdf with %PDF magic
  try {
    const jpg = fs.readFileSync(imgPath);
    const res = await render({
      value: new Uint8Array(jpg),
      width: 800,
      format: "pdf",
    });
    const out = res.data;
    if (
      !(out instanceof Uint8Array) ||
      Buffer.from(out.subarray(0, 4)).toString("latin1") !== "%PDF"
    ) {
      throw new Error(`pdf magic mismatch: len=${out?.length}`);
    }
    results.g = "PASS";
    details.g_imgpdf = `jpg->pdf len=${out.length} magic=%PDF`;
  } catch (e) {
    results.g = "FAIL";
    details.g_imgpdf = String(e?.message ?? e).slice(0, 300);
  }
  // h. avif roundtrip: jpg -> avif (ftyp) -> png (89PNG)
  try {
    const jpg = fs.readFileSync(imgPath);
    const resAvif = await render({
      value: new Uint8Array(jpg),
      format: "avif",
      quality: 50,
      speed: 6,
    });
    const avif = resAvif.data;
    if (
      !(avif instanceof Uint8Array) ||
      Buffer.from(avif.subarray(4, 12)).toString("latin1") !== "ftypavif"
    ) {
      throw new Error(`avif magic mismatch: len=${avif?.length}`);
    }
    const resBack = await render({ value: avif, format: "png" });
    const back = resBack.data;
    if (
      !(back instanceof Uint8Array) ||
      !Buffer.from(back.subarray(0, 4)).toString("hex").startsWith("89504e47")
    ) {
      throw new Error(`avif->png mismatch: len=${back?.length}`);
    }
    results.h = "PASS";
    details.h_avif = `jpg->avif len=${avif.length} magic=ftypavif ->png len=${back.length}`;
  } catch (e) {
    results.h = "FAIL";
    details.h_avif = String(e?.message ?? e).slice(0, 300);
  }
  // i. animated gif input -> animated webp (ANMF preserved)
  try {
    const gif = fs.readFileSync(
      path.join(repoRoot, "packages", "visual-test", "assets", "anim-2f.gif"),
    );
    const res = await render({
      value: new Uint8Array(gif),
      format: "webp",
      quality: 80,
      animation: true,
    });
    const out = res.data;
    const head = Buffer.from(out);
    const anim = !!(head.readUInt32LE(20) & 2);
    const anmf = (head.toString("latin1").match(/ANMF/g) || []).length;
    if (!(out instanceof Uint8Array) || !anim || anmf < 2) {
      throw new Error(
        `animated webp mismatch: len=${out?.length} anim=${anim} anmf=${anmf}`,
      );
    }
    results.i = "PASS";
    details.i_anim = `gif->animated-webp len=${out.length} anmf=${anmf}`;
  } catch (e) {
    results.i = "FAIL";
    details.i_anim = String(e?.message ?? e).slice(0, 300);
  }
} catch (e) {
  for (const k of ["e", "f", "g", "h", "i"]) {
    results[k] = "FAIL";
    details[`${k}_harness`] =
      `facade load error: ${String(e?.message ?? e).slice(0, 300)}`;
  }
}
console.log(
  `e(facade html->png): ${results.e} -- ${details.e_html ?? details.e_harness ?? ""}`,
);
console.log(
  `f(facade img->svg): ${results.f} -- ${details.f_imgsvg ?? details.f_harness ?? ""}`,
);
console.log(
  `g(facade img->pdf): ${results.g} -- ${details.g_imgpdf ?? details.g_harness ?? ""}`,
);
console.log(
  `h(facade avif roundtrip): ${results.h} -- ${details.h_avif ?? details.h_harness ?? ""}`,
);
console.log(
  `i(facade anim gif->webp): ${results.i} -- ${details.i_anim ?? details.i_harness ?? ""}`,
);
process.exit(Object.values(results).every((r) => r === "PASS") ? 0 : 1);
