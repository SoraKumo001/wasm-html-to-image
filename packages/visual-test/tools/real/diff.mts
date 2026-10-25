/**
 * Compare the engine with Chromium on one real page, from a snapshot.
 *
 *   pnpm real:diff <url> [--width 1000] [--refresh] [--top 12] [--out dir] [--no-ua-body-margin]
 *
 * Prints the page height ratio, per-band pixel difference, and the boxes where the layouts part
 * ways (entry points of a divergence, and likely height culprits), and writes a side-by-side image
 * of the worst region. Everything runs offline against `.real-cache/<slug>/`.
 *
 * The engine side is measured with Chromium's UA body margin applied (`chromiumBodyMargin`), since
 * the engine's own master CSS keeps `body` at margin 0; `--no-ua-body-margin` drops that
 * correction.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import {
  CACHE_DIR,
  chromiumBodyMargin,
  compareBoxes,
  ensureDir,
  launchChromium,
  measureChrome,
  measureOurs,
  pixelStats,
  sideBySide,
  slugOf,
  snapshot,
  type BoxDelta,
} from "./lib.mts";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = process.argv[2];
if (!url || url.startsWith("--")) {
  console.error("usage: real:diff <url> [--width 1000] [--refresh] [--top 12] [--out dir]");
  process.exit(2);
}
const width = Number(arg("width", "1000"));
const top = Number(arg("top", "12"));
const outDir = arg("out") ?? path.join(CACHE_DIR, slugOf(url), "out");

const fmt = (d: BoxDelta) => {
  const label = `${d.t}${d.i ? "#" + d.i : ""}${d.c ? "." + d.c.split(/\s+/)[0] : ""}`;
  return `${label.padEnd(34).slice(0, 34)} p=${d.p.padEnd(18)} y=${String(Math.round(d.ref.y)).padStart(6)}  dx=${d.dx} dy=${d.dy} dw=${d.dw} dh=${d.dh}`;
};

const store = await snapshot(url, { width, refresh: flag("refresh") });
console.log(`snapshot ${path.relative(process.cwd(), store.dir)}  (${store.size()} resources, ${store.manifest.capturedAt})`);

const browser = await launchChromium();
let chrome;
try {
  chrome = await measureChrome(browser, store, { url: store.finalUrl }, width);
} finally {
  await browser.close();
}
const ours = await measureOurs(store, { url: store.finalUrl }, width, {
  uaBodyMarginPx: flag("no-ua-body-margin") ? undefined : chromiumBodyMargin(chrome),
});

const cmp = compareBoxes(ours.boxes, chrome.boxes);
const px = pixelStats(ours.png, chrome.png);

console.log(`\nheight   chromium ${chrome.height}   ours ${ours.height}   ratio ${(ours.height / chrome.height).toFixed(3)}`);
console.log(`boxes    matched ${cmp.matched}   ours-only ${cmp.oursOnly}   chromium-only ${cmp.chromeOnly}   off-by->1.5px ${cmp.bad.length}`);
console.log(`pixels   ${(px.ratio * 100).toFixed(2)}% differ over ${px.rows}px`);
const worst = px.bands.map((r, i) => ({ r, y: i * px.band })).sort((a, b) => b.r - a.r).slice(0, 5);
console.log(`worst bands (y: %): ${worst.map((w) => `${w.y}: ${(w.r * 100).toFixed(1)}`).join("   ")}`);

console.log(`\nheight culprits (own height differs, no child explains it) -- top ${top} by page position:`);
for (const d of cmp.heightCulprits.slice(0, top)) console.log("  " + fmt(d));
console.log(`\nentry points (off while the parent is fine) -- first ${top} in page order:`);
for (const d of [...cmp.entries].sort((a, b) => a.ref.y - b.ref.y).slice(0, top)) console.log("  " + fmt(d));

ensureDir(outDir);
const focus = cmp.heightCulprits[0] ?? [...cmp.entries].sort((a, b) => a.ref.y - b.ref.y)[0];
const y0 = Math.max(0, Math.round((focus?.ref.y ?? worst[0].y) - 80));
const shot = sideBySide(chrome.png, ours.png, y0, Math.min(700, Math.max(1, Math.min(chrome.png.height, ours.png.height) - y0)));
fs.writeFileSync(path.join(outDir, "focus.png"), PNG.sync.write(shot));
fs.writeFileSync(
  path.join(outDir, "report.json"),
  JSON.stringify({ url, width, chromeHeight: chrome.height, oursHeight: ours.height, pixels: px, boxes: { matched: cmp.matched, oursOnly: cmp.oursOnly, chromeOnly: cmp.chromeOnly, bad: cmp.bad.length }, heightCulprits: cmp.heightCulprits.slice(0, 50), entries: cmp.entries.slice(0, 50) }, null, 1),
);
console.log(`\nwrote ${path.relative(process.cwd(), path.join(outDir, "focus.png"))} (left Chromium, right engine, from y=${y0}) and report.json`);
