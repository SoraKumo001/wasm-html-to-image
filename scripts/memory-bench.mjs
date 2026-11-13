// Memory benchmark for wasm-html-to-image (baseline & regression check).
// Usage: node scripts/memory-bench.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const facadeUrl = pathToFileURL(
  path.join(repoRoot, "packages", "html-to-image", "dist", "single.js"),
).href;
const imgPath = path.join(
  repoRoot,
  "packages",
  "visual-test",
  "assets",
  "images",
  "image01.jpg",
);

const { render } = await import(facadeUrl);
const jpgBase64 = fs.readFileSync(imgPath).toString("base64");

function snapMem() {
  const m = process.memoryUsage();
  return {
    rssMb: +(m.rss / 1048576).toFixed(2),
    heapUsedMb: +(m.heapUsed / 1048576).toFixed(2),
    externalMb: +(m.external / 1048576).toFixed(2),
    arrayBuffersMb: +(m.arrayBuffers / 1048576).toFixed(2),
  };
}

const baseline = snapMem();

// Scenario 1: Repeated HTML + SVG renders
const t0 = performance.now();
let peakRss = baseline.rssMb;
let peakAb = baseline.arrayBuffersMb;

for (let i = 0; i < 20; i++) {
  const html = `
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; background: #f8fafc; }
      circle { cx: 40px; cy: 40px; r: ${15 + (i % 15)}px; fill: #2563eb; }
    </style>
    <div>
      <h1>Render #${i}</h1>
      <svg width="80" height="80" xmlns="http://www.w3.org/2000/svg"><circle/></svg>
    </div>
  `;
  const res = await render({ value: html, width: 640, height: 480, format: "png" });
  if (!(res.data instanceof Uint8Array) || res.data.length === 0) {
    throw new Error(`Scenario 1 failed at i=${i}`);
  }
  const m = snapMem();
  if (m.rssMb > peakRss) peakRss = m.rssMb;
  if (m.arrayBuffersMb > peakAb) peakAb = m.arrayBuffersMb;
}
const afterHtmlSvg = snapMem();
const htmlSvgMs = +(performance.now() - t0).toFixed(1);

// Scenario 2: Repeated renders with unique embedded images (stresses imageCache)
const t1 = performance.now();
for (let i = 0; i < 15; i++) {
  // Unique fragment per image URL/data to simulate distinct image keys
  const svgWithImg = `
    <div style="padding:12px;">
      <img src="data:image/jpeg;base64,${jpgBase64}#${i}" width="128" height="128" />
      <p>Image ${i}</p>
    </div>
  `;
  const res = await render({ value: svgWithImg, width: 400, height: 300, format: "png" });
  if (!(res.data instanceof Uint8Array) || res.data.length === 0) {
    throw new Error(`Scenario 2 failed at i=${i}`);
  }
  const m = snapMem();
  if (m.rssMb > peakRss) peakRss = m.rssMb;
  if (m.arrayBuffersMb > peakAb) peakAb = m.arrayBuffersMb;
}
const afterImages = snapMem();
const imagesMs = +(performance.now() - t1).toFixed(1);

console.log(
  JSON.stringify(
    {
      baseline,
      afterHtmlSvg,
      htmlSvgMs,
      afterImages,
      imagesMs,
      peakRssMb: peakRss,
      peakArrayBuffersMb: peakAb,
    },
    null,
    2,
  ),
);
