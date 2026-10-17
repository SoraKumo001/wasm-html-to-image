// Renders every vertical/cases/*.html with Chromium (reference) and with the wasm engine,
// then writes a side-by-side montage (ref | ours) to vertical/out/ and prints metrics.
// Usage: tsx vertical/compare.ts [filter] [--format=png]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { render } from "wasm-html-to-image/single";
import { compareImages } from "../src/utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(here, "cases");
const OUT = path.join(here, "out");
const WIDTH = 800;
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
fs.mkdirSync(OUT, { recursive: true });

const files = fs
  .readdirSync(CASES)
  .filter((f) => f.endsWith(".html") && (!filter || f.includes(filter)))
  .sort();

function montage(a: PNG, b: PNG): PNG {
  const gap = 8;
  const h = Math.max(a.height, b.height);
  const out = new PNG({ width: a.width + b.width + gap, height: h });
  out.data.fill(200);
  const blit = (src: PNG, ox: number) => {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const s = (src.width * y + x) << 2;
        const d = (out.width * y + x + ox) << 2;
        out.data[d] = src.data[s];
        out.data[d + 1] = src.data[s + 1];
        out.data[d + 2] = src.data[s + 2];
        out.data[d + 3] = 255;
      }
  };
  blit(a, 0);
  blit(b, a.width + gap);
  return out;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "C:/Users/oikawa/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe" });
const rows: string[] = [];
for (const file of files) {
  const name = file.replace(".html", "");
  const html = fs.readFileSync(path.join(CASES, file), "utf8");
  try {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(CASES, file)).toString());
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const height = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    );
    await page.setViewportSize({ width: WIDTH, height: Math.max(1, Math.ceil(height)) });
    const refBuf = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: Math.max(1, Math.ceil(height)) } });
    await ctx.close();

    const t0 = Date.now();
    const { data } = await render({ value: html, width: WIDTH, format: "png", baseUrl: CASES });
    const ms = Date.now() - t0;
    const ref = PNG.sync.read(refBuf);
    const ours = PNG.sync.read(Buffer.from(data));
    const m = compareImages(ref, ours, path.join(OUT, `diff-${name}`));
    fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(montage(ref, ours)));
    rows.push(
      `${name.padEnd(30)} fill ${m.fill.toFixed(1).padStart(5)}%  outline ${m.outline.toFixed(1).padStart(5)}%  ref ${ref.width}x${ref.height} ours ${ours.width}x${ours.height}  ${ms}ms`,
    );
  } catch (e) {
    rows.push(`${name.padEnd(30)} ERROR ${(e as Error).message}`);
  }
}
await browser.close();
console.log(rows.join("\n"));
