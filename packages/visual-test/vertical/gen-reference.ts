// Renders every vertical/cases/*.html with Chromium into vertical/reference/*.png.
// Usage: tsx vertical/gen-reference.ts   (CHROMIUM_PATH overrides the browser executable)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(here, "cases");
const REF = path.join(here, "reference");
const WIDTH = 800;
fs.mkdirSync(REF, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith(".html")).sort()) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(CASES, file)).toString());
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const height = Math.max(
    1,
    Math.ceil(await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))),
  );
  await page.setViewportSize({ width: WIDTH, height });
  fs.writeFileSync(
    path.join(REF, file.replace(".html", ".png")),
    await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height } }),
  );
  await ctx.close();
}
await browser.close();
console.log("done");
