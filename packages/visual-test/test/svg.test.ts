import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "wasm-html-to-image/single";
import { PNG } from "pngjs";
import { compareImages } from "../src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, "../assets");
const REFERENCE_DIR = path.resolve(__dirname, "../reference");
const DIFF_DIR = path.resolve(__dirname, "../diff");
const TEMP_DIR = path.resolve(__dirname, "../temp");
const BASELINE_PATH = path.join(__dirname, "data/svg-mismatch-baselines.json");

// All 25 upstream assets (sorted for determinism).
const FILES = fs
  .readdirSync(ASSETS_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort();

import { chromium } from "playwright";

/**
 * Locate a Chromium binary:
 * 1. CHROME_PATH environment variable
 * 2. playwright's chromium.executablePath()
 * 3. PLAYWRIGHT_BROWSERS_PATH / home ms-playwright directories
 * 4. System installed browsers
 */
function findChrome(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // Playwright executable not found or errored
  }
  const home = os.homedir();
  const candidates: string[] = [];
  const roots = [
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? [process.env.PLAYWRIGHT_BROWSERS_PATH]
      : []),
    path.join(home, "AppData/Local/ms-playwright"),
    path.join(home, ".cache/ms-playwright"),
    path.join(home, "Library/Caches/ms-playwright"),
  ];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      candidates.push(
        path.join(root, e, "chrome-win64/chrome.exe"),
        path.join(root, e, "chrome-win/chrome.exe"),
        path.join(root, e, "chrome-linux/chrome"),
        path.join(
          root,
          e,
          "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ),
        path.join(
          root,
          e,
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ),
      );
    }
  }
  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Chromium binary not found. Install browsers or set CHROME_PATH to a chrome executable.",
  );
}

function screenshotSvg(
  svg: string,
  svgWidth: number,
  svgHeight: number,
  outPng: string,
): void {
  const wrapper = path.join(
    TEMP_DIR,
    `svg-shot-${process.pid}-${Date.now()}.html`,
  );
  fs.writeFileSync(
    wrapper,
    `<style>body { margin: 0; padding: 0; overflow: hidden; }</style>${svg}`,
  );
  try {
    execFileSync(
      findChrome(),
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        `--screenshot=${outPng}`,
        `--window-size=${svgWidth},${svgHeight}`,
        `file:///${wrapper.replace(/\\/g, "/")}`,
      ],
      { timeout: 120000, stdio: "pipe" },
    );
  } finally {
    try {
      fs.rmSync(wrapper, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

describe("SVG (Chromium) Visual Tests", { timeout: 60000 }, () => {
  let baselines: Record<string, { fill: number; outline: number }> = {};

  beforeAll(() => {
    [DIFF_DIR, TEMP_DIR].forEach(
      (dir) => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }),
    );
    // Fail fast with a clear message when no browser is available.
    findChrome();
    if (fs.existsSync(BASELINE_PATH)) {
      baselines = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    }
  });

  afterAll(() => {
    if (process.env.UPDATE_SNAPSHOTS) {
      const current = fs.existsSync(BASELINE_PATH)
        ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
        : {};

      for (const file in baselines) {
        current[file] = baselines[file];
      }

      const dir = path.dirname(BASELINE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2));
    }
  });

  for (const file of FILES) {
    it(`SVG: ${file}`, async () => {
      const refPath = path.join(REFERENCE_DIR, file.replace(".html", ".png"));
      const html = fs.readFileSync(path.join(ASSETS_DIR, file), "utf8");

      const { data: svg } = await render({
        value: html,
        width: 800,
        format: "svg",
        baseUrl: ASSETS_DIR,
      });

      fs.writeFileSync(path.join(TEMP_DIR, file.replace(".html", ".svg")), svg);

      const widthMatch = svg.match(/width="(\d+)"/);
      const heightMatch = svg.match(/height="(\d+)"/);
      const svgWidth = widthMatch ? parseInt(widthMatch[1], 10) : 800;
      const svgHeight = heightMatch ? parseInt(heightMatch[1], 10) : 1000;

      const shotPath = path.join(
        TEMP_DIR,
        `svg-${file.replace(".html", ".png")}`,
      );
      screenshotSvg(svg, svgWidth, svgHeight, shotPath);

      if (!fs.existsSync(refPath)) {
        throw new Error(`Reference image missing for ${file}.`);
      }
      const refImg = PNG.sync.read(fs.readFileSync(refPath));
      const currentImg = PNG.sync.read(fs.readFileSync(shotPath));

      const result = compareImages(
        refImg,
        currentImg,
        path.join(DIFF_DIR, `svg-${file.replace(".html", "")}`),
      );

      console.log(
        `${file} (SVG): Fill: ${result.fill.toFixed(2)}%, Outline: ${result.outline.toFixed(2)}%`,
      );
      baselines[file] = result;

      // Upstream SVG thresholds (looser: browser rasterization differences).
      expect(result.outline).toBeLessThan(25);
      expect(result.fill).toBeLessThan(45);
    });
  }
});
