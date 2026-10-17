// Cross-format consistency: renders selected vertical cases as PNG, SVG and PDF with the wasm
// engine, rasterizes SVG/PDF with Chromium, and compares each against the engine's own PNG.
// Usage: tsx vertical/formats.ts [case-substring...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { render } from "wasm-html-to-image/single";
import { compareImages } from "../src/utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(here, "cases");
const OUT = path.join(here, "out", "formats");
fs.mkdirSync(OUT, { recursive: true });
const WIDTH = 800;
const picks = process.argv.slice(2);
const files = fs
  .readdirSync(CASES)
  .filter((f) => f.endsWith(".html") && (picks.length ? picks.some((p) => f.includes(p)) : true))
  .sort();

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    "C:/Users/oikawa/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe",
});

async function shot(url: string, h: number): Promise<PNG> {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(500);
  const buf = await page.screenshot();
  await ctx.close();
  return PNG.sync.read(buf);
}

const rows: string[] = [];
for (const file of files) {
  const name = file.replace(".html", "");
  const html = fs.readFileSync(path.join(CASES, file), "utf8");
  try {
    const png = await render({ value: html, width: WIDTH, format: "png", baseUrl: CASES });
    const pngImg = PNG.sync.read(Buffer.from(png.data));
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png.data));

    const svg = await render({ value: html, width: WIDTH, format: "svg", baseUrl: CASES });
    const svgPath = path.join(OUT, `${name}.svg`);
    fs.writeFileSync(svgPath, Buffer.from(svg.data));
    const svgImg = await shot(pathToFileURL(svgPath).toString(), pngImg.height);
    const ms = compareImages(pngImg, svgImg, path.join(OUT, `diff-svg-${name}`));
    fs.writeFileSync(path.join(OUT, `${name}.svg.png`), PNG.sync.write(svgImg));

    let pdfNote = "";
    try {
      const pdf = await render({ value: html, width: WIDTH, format: "pdf", baseUrl: CASES });
      const pdfPath = path.join(OUT, `${name}.pdf`);
      fs.writeFileSync(pdfPath, Buffer.from(pdf.data));
      pdfNote = `pdf ${pdf.data.byteLength}B`;
    } catch (e) {
      pdfNote = `pdf ERROR ${(e as Error).message}`;
    }
    rows.push(
      `${name.padEnd(28)} svg-vs-png fill ${ms.fill.toFixed(1).padStart(5)}% outline ${ms.outline.toFixed(1).padStart(5)}%  size png ${pngImg.width}x${pngImg.height} svg ${svgImg.width}x${svgImg.height}  ${pdfNote}`,
    );
  } catch (e) {
    rows.push(`${name.padEnd(28)} ERROR ${(e as Error).message}`);
  }
}
await browser.close();
console.log(rows.join("\n"));
