// Single-WASM smoke test (reproducible).
// Usage: node scripts/smoke-test.mjs [test-image-path]
// Loads packages/html-to-image/dist/html-to-image-single.js and checks:
//   a. converter_encode (test01.jpg -> webp/png, magic RIFF/89PNG)
//   b. satoru_render returns null without crashing (renderers unported)
//   c. html_to_image responds without crashing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const singleJs = path.join(repoRoot, "packages", "html-to-image", "dist", "html-to-image-single.js");
const defaultImg = "C:/prog/npms/@node-libraries/wasm-image-optimization/images/test01.jpg";
const imgPath = process.argv[2] ?? defaultImg;

// RenderFormat enum (mirrors bridge_types.h / wasm-image-optimization core.ts)
const FMT = { SVG: 0, PNG: 1, WebP: 2, PDF: 3, JPEG: 4, AVIF: 5, RAW: 6, ThumbHash: 7 };

const results = { a: "SKIP", b: "SKIP", c: "SKIP" };
const details = {};

const mod = await (await import(pathToFileURL(singleJs).href)).default();
console.log(`loaded single.js keys: ${Object.keys(mod).filter((k) => /satoru|converter|html_to_image/.test(k)).join(",")}`);

// ---- a. converter roundtrip (load_image -> encode webp -> crop -> encode png) ----
try {
  const jpg = fs.readFileSync(imgPath);
  details.a_input = `test01.jpg len=${jpg.length} head=${Buffer.from(jpg.subarray(0, 4)).toString("hex")}`;
  const ci = mod.converter_create_instance();
  const steps = [];
  try {
    const loaded = mod.converter_load_image(ci, jpg);
    steps.push(`load=${loaded}`);
    if (!loaded) throw new Error("converter_load_image => false");
    steps.push(`orig=${mod.converter_get_original_width(ci)}x${mod.converter_get_original_height(ci)} ${mod.converter_get_original_format(ci)}`);
    const webp = mod.converter_encode(ci, FMT.WebP, 80, 6, false);
    if (webp === null || webp === undefined) throw new Error("converter_encode(webp) => null");
    const wb = Buffer.from(webp);
    if (wb.subarray(0, 4).toString("latin1") !== "RIFF") {
      throw new Error(`webp magic mismatch: ${wb.subarray(0, 8).toString("hex")}`);
    }
    steps.push(`webp len=${wb.length} magic=RIFF(webp)`);
    const cropped = mod.converter_crop(ci, 0, 0, 8, 8);
    steps.push(`crop=${cropped} size=${mod.converter_get_width(ci)}x${mod.converter_get_height(ci)}`);
    if (!cropped) throw new Error("converter_crop => false");
    const png = mod.converter_encode(ci, FMT.PNG, 0, 0, false);
    if (png === null || png === undefined) throw new Error("converter_encode(png) => null");
    const pb = Buffer.from(png);
    if (!pb.subarray(0, 4).toString("hex").startsWith("89504e47")) {
      throw new Error(`png magic mismatch: ${pb.subarray(0, 8).toString("hex")}`);
    }
    steps.push(`png len=${pb.length} magic=89PNG`);
    results.a = "PASS";
    details.a_encode = steps.join(" | ");
  } catch (e) {
    results.a = "FAIL";
    details.a_encode = `${steps.join(" | ")} || ${String(e?.message ?? e).slice(0, 300)}`;
  }
  try { mod.converter_destroy_instance(ci); } catch {}
} catch (e) {
  results.a = "FAIL";
  details.a_encode = `harness error: ${String(e?.message ?? e).slice(0, 300)}`;
}

// ---- b. satoru_render (expect null, no crash) ----
try {
  const si = mod.satoru_create_instance();
  let out;
  let threw = null;
  try {
    out = mod.satoru_render(si, "<h1>hi</h1>", 800, 600, FMT.PNG, {});
  } catch (e) {
    threw = String(e?.message ?? e).slice(0, 300);
  }
  if (threw) {
    results.b = "FAIL";
    details.b_render = `throw (crash): ${threw}`;
  } else if (out === null || out === undefined) {
    results.b = "PASS";
    details.b_render = "satoru_render => null (expected; renderers unported, no crash)";
  } else {
    results.b = "PASS";
    details.b_render = `satoru_render => bytes len=${out.length} (unexpected but no crash)`;
  }
  try { mod.satoru_destroy_instance(si); } catch {}
} catch (e) {
  results.b = "FAIL";
  details.b_render = `harness error: ${String(e?.message ?? e).slice(0, 300)}`;
}

// ---- c. html_to_image (no crash, any response) ----
try {
  let out;
  let threw = null;
  try {
    out = mod.html_to_image("<h1>hi</h1>", 800, 600, FMT.PNG, {}, 80, 6, false);
  } catch (e) {
    threw = String(e?.message ?? e).slice(0, 300);
  }
  if (threw) {
    results.c = "FAIL";
    details.c_unified = `throw (crash): ${threw}`;
  } else if (out === null || out === undefined) {
    results.c = "PASS";
    details.c_unified = "html_to_image => null (no crash; satoru stub propagates null)";
  } else {
    details.c_unified = `html_to_image => len=${out.length} head=${Buffer.from(out.subarray(0, 8)).toString("hex")}`;
    results.c = "PASS";
  }
} catch (e) {
  results.c = "FAIL";
  details.c_unified = `harness error: ${String(e?.message ?? e).slice(0, 300)}`;
}

console.log(JSON.stringify({ results, details, imgPath }, null, 2));
console.log(`a(converter_encode): ${results.a} -- ${details.a_input ?? ""} | ${details.a_encode ?? ""}`);
console.log(`b(satoru_render=null): ${results.b} -- ${details.b_render ?? ""}`);
console.log(`c(html_to_image no-crash): ${results.c} -- ${details.c_unified ?? ""}`);
process.exit(results.a === "PASS" && results.b === "PASS" && results.c === "PASS" ? 0 : 1);
