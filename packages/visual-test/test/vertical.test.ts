import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "wasm-html-to-image/single";
import { PNG } from "pngjs";
import { compareImages } from "../src/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.resolve(__dirname, "../vertical/cases");
const REFERENCE_DIR = path.resolve(__dirname, "../vertical/reference");
const DIFF_DIR = path.resolve(__dirname, "../diff");
const BASELINE_PATH = path.join(__dirname, "data/vertical-baselines.json");

// Allowed growth over the recorded mismatch (percentage points) before a case is a regression.
const MARGIN = 1.5;

type Baseline = { fill: number; outline: number; width: number; height: number };

const FILES = fs
  .readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort();

describe("Vertical writing regression (vs Chromium)", () => {
  const baselines: Record<string, Baseline> = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
    : {};
  const measured: Record<string, Baseline> = {};
  fs.mkdirSync(DIFF_DIR, { recursive: true });

  afterAll(() => {
    if (process.env.UPDATE_SNAPSHOTS) {
      fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
      fs.writeFileSync(BASELINE_PATH, JSON.stringify({ ...baselines, ...measured }, null, 2));
    }
  });

  for (const file of FILES) {
    const name = file.replace(".html", "");
    it(`vertical: ${name}`, async () => {
      const refPath = path.join(REFERENCE_DIR, `${name}.png`);
      if (!fs.existsSync(refPath)) throw new Error(`Reference image missing for ${file}.`);

      const html = fs.readFileSync(path.join(CASES_DIR, file), "utf8");
      const { data } = await render({ value: html, width: 800, format: "png", baseUrl: CASES_DIR });
      const ref = PNG.sync.read(fs.readFileSync(refPath));
      const cur = PNG.sync.read(Buffer.from(data));
      const m = compareImages(ref, cur, path.join(DIFF_DIR, `vertical-${name}`));
      measured[file] = { fill: m.fill, outline: m.outline, width: cur.width, height: cur.height };

      if (process.env.UPDATE_SNAPSHOTS) return;
      const base = baselines[file];
      if (!base) throw new Error(`No baseline for ${file}; run test:update.`);
      expect(m.fill, `${file} fill (outline ${m.outline}, height ${cur.height})`).toBeLessThanOrEqual(base.fill + MARGIN);
      expect(m.outline, `${file} outline (fill ${m.fill}, height ${cur.height})`).toBeLessThanOrEqual(base.outline + MARGIN);
      // The page size must not drift away from the recorded one by more than a few pixels.
      expect(Math.abs(cur.height - base.height)).toBeLessThanOrEqual(2);
    });
  }
});
