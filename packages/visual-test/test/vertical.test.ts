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

// Representative subset: rl/lr basics, horizontal runs inside vertical text
// (and the mirror case), rotation/orientation and decorations. The remaining
// upstream cases are still generated into ../vertical/cases for manual checks.
const CASES = [
  "01-basic-rl.html",
  "02-basic-lr.html",
  "04-latin-mixed.html",
  "05-orientation.html",
  "14-decoration.html",
  "26-horizontal-in-vertical.html",
  "27-vertical-in-horizontal.html",
  "34-transform.html",
  "50-deco-underline-only.html",
  "81-deco-overline.html",
  // Added because the Chromium reference PNGs are stable (low residual diff and
  // identical page size in a full compare.ts sweep): tate-chu-yoko at several
  // digit counts, inline-block inside vertical text (baseline/alignment), the
  // remaining decoration lines, long unbreakable Latin, flex centering and images.
  "06-tcy.html",
  "57-tcy-two-digits.html",
  "94-tcy-lens.html",
  "55-inline-block-nofixed.html",
  "85-ib-valign-top.html",
  "51-deco-linethrough-only.html",
  "70-very-long-latin.html",
  "25-flex-center.html",
  "19-images.html",
];

// Cases that must stay out of the numeric regression suite until the underlying
// feature is fixed. Do not record their current output as an expectation: that
// would lock in the known-bad rendering.
const KNOWN_LIMITATIONS: Array<{ file: string; reason: string }> = [
  {
    file: "63-grid.html",
    reason: "inline-grid only supports fixed tracks + a single implicit auto column (auto/fr shrink unsupported)",
  },
  {
    file: "79b-ruby-compound-h.html",
    reason: "compound ruby: annotations are centered over the base instead of distributed per base char",
  },
  {
    file: "79c-ruby-compound-v.html",
    reason: "compound ruby: annotations are centered over the base instead of distributed per base char",
  },
  {
    file: "79d-ruby-rtc.html",
    reason: "compound ruby: <rtc> falls back to inline in Chromium while we still treat it as ruby",
  },
  {
    file: "79e-ruby-jukugo-2char.html",
    reason: "compound ruby: per-base distribution of the jukugo annotation is not implemented",
  },
  {
    file: "62-pseudo.html",
    reason: "::first-letter does not yet expand through the whole first-letter sequence; punctuation-only leading text is unverified",
  },
  {
    file: "03-punct.html",
    reason: "text-spacing-trim (punctuation trimming) is a deliberate spec difference, not a regression",
  },
  {
    file: "17-kinsoku.html",
    reason: "text-spacing-trim (punctuation trimming) is a deliberate spec difference, not a regression",
  },
];

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

  for (const file of CASES) {
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

  // Keep the opt-out list honest: the files and their Chromium references must
  // still exist, so a removed/renamed case cannot silently stay skipped.
  it("known-limitation cases still exist", () => {
    for (const { file } of KNOWN_LIMITATIONS) {
      expect(fs.existsSync(path.join(CASES_DIR, file)), file).toBe(true);
      expect(fs.existsSync(path.join(REFERENCE_DIR, file.replace(".html", ".png"))), file).toBe(true);
    }
  });

  for (const { file, reason } of KNOWN_LIMITATIONS) {
    it.skip(`vertical (known limitation): ${file.replace(".html", "")} - ${reason}`, () => {});
  }
});
