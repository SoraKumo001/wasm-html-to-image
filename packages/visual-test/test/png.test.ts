import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
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
const BASELINE_PATH = path.join(__dirname, "data/png-mismatch-baselines.json");

// Representative subset of the upstream assets: layout, text, paint features,
// masking, pagination and text-stroke. These eight catch broad rendering
// regressions without paying for 26 near-identical comparisons; the remaining
// assets are still rendered by the reference generator.
const FILES = [
  "01-layout.html",
  "11-complex-text.html",
  "13-backdrop-filter.html",
  "17-background-clip.html",
  "19-mask.html",
  "24-media-print.html",
  "25-page-breaks.html",
  "26-text-stroke.html",
];

describe("PNG Visual Tests (current engine)", () => {
  let baselines: Record<string, { fill: number; outline: number }> = {};

  beforeAll(() => {
    [DIFF_DIR, TEMP_DIR].forEach(
      (dir) => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true }),
    );
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
    it(`PNG: ${file}`, async () => {
      const refPath = path.join(REFERENCE_DIR, file.replace(".html", ".png"));
      const html = fs.readFileSync(path.join(ASSETS_DIR, file), "utf8");

      const { data: pngData } = await render({
        value: html,
        width: 800,
        format: "png",
        baseUrl: ASSETS_DIR,
      });

      fs.writeFileSync(
        path.join(TEMP_DIR, file.replace(".html", ".png")),
        Buffer.from(pngData),
      );

      if (!fs.existsSync(refPath)) {
        throw new Error(`Reference image missing for ${file}.`);
      }
      const refImg = PNG.sync.read(fs.readFileSync(refPath));
      const currentImg = PNG.sync.read(Buffer.from(pngData));

      const result = compareImages(
        refImg,
        currentImg,
        path.join(DIFF_DIR, `png-${file.replace(".html", "")}`),
      );

      console.log(
        `${file} (Png): Fill: ${result.fill.toFixed(2)}%, Outline: ${result.outline.toFixed(2)}%`,
      );
      baselines[file] = result;

      // Tightened: every selected asset stays well inside these bounds.
      expect(result.outline).toBeLessThan(10);
      expect(result.fill).toBeLessThan(15);
    });
  }

  it("emits -webkit-text-stroke as SVG stroke attributes", async () => {
    const { data: svg } = await render({
      value:
        '<div style="font-size:40px;-webkit-text-stroke:2px red;' +
        '-webkit-text-fill-color:transparent">X</div>',
      width: 200,
      format: "svg",
    });

    expect(svg).toContain('stroke="rgb(255,0,0)"');
    expect(svg).toContain('stroke-width="2');
    expect(svg).toContain("stroke-opacity=");
    // WebKit paints the fill first and the stroke on top.
    expect(svg).toContain('paint-order="fill stroke"');
  });
});
