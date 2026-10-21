import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import http from "node:http";
import { render } from "wasm-html-to-image/single";
import { PNG } from "pngjs";

// Text-free pixel probes for layout/paint behaviors that were once broken.
// Each case renders a tiny document and samples pixel colors at known points,
// so no Chromium reference image is needed.

type Rgb = [number, number, number];

async function renderPng(body: string, width = 300, height = 200) {
  const html = `<html><body style="margin:0;background:#fff">${body}</body></html>`;
  const { data } = await render({ value: html, width, height, format: "png" });
  const img = PNG.sync.read(Buffer.from(data));
  const at = (x: number, y: number): Rgb => {
    const i = (img.width * y + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  return { img, at };
}

const isWhite = ([r, g, b]: Rgb) => r > 245 && g > 245 && b > 245;
const near = (a: Rgb, b: Rgb, tol = 12) =>
  a.every((v, i) => Math.abs(v - b[i]) <= tol);

const BLUE: Rgb = [0, 0, 255];
const RED: Rgb = [255, 0, 0];

// Local probe font (same Roboto as assets/02-typography.html). Text probes below
// compare rendered bytes, so the font only has to be stable, not reference-matched.
const PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoProbe';src:url('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2') format('woff2')}";

// Variable Roboto (wght axis) and variable Roboto Flex (wdth axis). They are
// used by the font-variation-settings / font-stretch probes.
const VAR_PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoVar';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto@5.3.0/files/roboto-latin-wght-normal.woff2') format('woff2')}";

const FLEX_PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoFlex';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.3.0/files/roboto-flex-latin-wdth-normal.woff2') format('woff2')}";

// A family with a regular and a condensed face. The face is picked by the
// requested font-stretch. Only fonts that keep their width class in the OS/2
// table can be told apart (Google Fonts normalizes it to "normal").
const REGULAR_FONT_FACE =
  "@font-face{font-family:'StretchRegular';src:url('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.3.0/files/roboto-latin-400-normal.woff2') format('woff2')}";

const CONDENSED_FONT_FACE =
  "@font-face{font-family:'StretchCondensed';src:url('https://cdn.jsdelivr.net/npm/@fontsource/pt-sans-narrow@5.3.0/files/pt-sans-narrow-latin-400-normal.woff2') format('woff2')}";

const STRETCH_PAIR_FONT_FACE =
  "@font-face{font-family:'StretchPair';src:url('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.3.0/files/roboto-latin-400-normal.woff2') format('woff2')}" +
  "@font-face{font-family:'StretchPair';src:url('https://cdn.jsdelivr.net/npm/@fontsource/pt-sans-narrow@5.3.0/files/pt-sans-narrow-latin-400-normal.woff2') format('woff2')}";

async function renderProbeText(body: string, width = 800, fontFace = PROBE_FONT_FACE) {
  const html = `<html><head><style>${fontFace}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
  const { data } = await render({ value: html, width, format: "png" });
  return PNG.sync.read(Buffer.from(data));
}

const probeLine = (style: string, text: string, family = "'RobotoProbe'") =>
  `<div style="font-family:${family},sans-serif;font-size:60px;line-height:90px;color:#000;${style}">${text}</div>`;

// Right edge of the painted ink on every text line of a probe image. The probes
// below pin line-height, so the ink of line i lies in rows
// [i * lineHeight, (i + 1) * lineHeight). One entry per line that has ink.
function lineRightEdges(img: PNG, lineHeight: number) {
  const edges: number[] = [];
  for (let y0 = 0; y0 < img.height; y0 += lineHeight) {
    let right = -1;
    for (let y = y0; y < Math.min(y0 + lineHeight, img.height); y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i + 3] > 0 && img.data[i] < 128) right = Math.max(right, x);
      }
    }
    if (right >= 0) edges.push(right + 1);
  }
  return edges;
}

// Spread (max - min) of the line lengths: the metric text-wrap-style: balance
// is supposed to reduce.
const lineEdgeSpread = (edges: number[]) =>
  Math.max(...edges) - Math.min(...edges);

// A red decoration line is anti-aliased against the white background, so a
// partially covered pixel still counts as red when it is clearly redder.
const isRedPixel = (img: PNG, x: number, y: number) => {
  const i = (img.width * y + x) * 4;
  const r = img.data[i];
  const g = img.data[i + 1];
  const b = img.data[i + 2];
  return r > 140 && r - g > 40 && r - b > 40;
};

// Row of the (red) decoration line and the number of red pixels on it.
const decorationLine = (img: PNG) => {
  let row = -1;
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    let rowCount = 0;
    for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) rowCount++;
    if (rowCount > count) {
      count = rowCount;
      row = y;
    }
  }
  return { row, count };
};

// Total number of (red) decoration pixels, used when the decoration covers
// more than one row (a thick line, for instance).
const redPixels = (img: PNG) => {
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) count++;
  }
  return count;
};

// Columns that carry the (red) decoration line, used for vertical writing modes.
const redColumns = (img: PNG) => {
  const cols: number[] = [];
  for (let x = 0; x < img.width; x++) {
    let count = 0;
    for (let y = 0; y < img.height; y++) if (isRedPixel(img, x, y)) count++;
    if (count > 3) cols.push(x);
  }
  return cols;
};

// One entry per ANMF (animation frame) chunk in a RIFF/WEBP container.
// The hash proves the sampled frames differ in pixel content; the rectangle
// is the region the encoder had to store (the part that changed).
type WebpFrame = {
  hash: number;
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
};

function webpFrames(data: Uint8Array): WebpFrame[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = (o: number) =>
    String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3),
    );
  if (data.byteLength < 12 || fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") {
    return [];
  }
  // ANMF frame header: 24 bit frame x/y, width-1, height-1 and duration.
  const u24 = (o: number) =>
    view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
  const frames: WebpFrame[] = [];
  let o = 12;
  while (o + 8 <= data.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (fourcc(o) === "ANMF") {
      let hash = 0;
      for (let i = o + 8; i < o + 8 + size && i < data.byteLength; i++) {
        hash = (hash * 31 + data[i]) >>> 0;
      }
      frames.push({
        hash,
        x: u24(o + 8) * 2,
        y: u24(o + 11) * 2,
        width: u24(o + 14) + 1,
        height: u24(o + 17) + 1,
        duration: u24(o + 20),
      });
    }
    o += 8 + size + (size & 1);
  }
  return frames;
}

// One 32-bit hash per ANMF (animation frame) chunk in a RIFF/WEBP container.
// Distinct hashes prove the sampled frames actually differ in pixel content.
function webpFrameHashes(data: Uint8Array): number[] {
  return webpFrames(data).map((frame) => frame.hash);
}

// ANIM chunk parameters of a RIFF/WEBP container:
//  - bgcolor   : canvas background colour (0xAARRGGBB)
//  - loopCount : number of animation repeats (0 = infinite)
// Returns null when the container carries no ANIM chunk (not animated).
function webpAnimParams(
  data: Uint8Array,
): { bgcolor: number; loopCount: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = (o: number) =>
    String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3),
    );
  let o = 12;
  while (o + 8 <= data.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (fourcc(o) === "ANIM") {
      return {
        bgcolor: view.getUint32(o + 8, true),
        loopCount: view.getUint16(o + 12, true),
      };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

// SHA-256 of the encoded bytes (used to pin the animated WebP output).
function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// A still encode of an animated document keeps the first sampled frame
// (progress 0): a still format can only carry a single frame.
async function renderFirstFrame(html: string, width: number, height: number) {
  const { data } = await render({
    value: html,
    width,
    height,
    format: "png",
    animation: { duration: 300, fps: 10 },
  });
  const img = PNG.sync.read(Buffer.from(data));
  return {
    img,
    at: (x: number, y: number): Rgb => {
      const i = (img.width * y + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    },
  };
}

// Number of opaque pixels matching the predicate.
function countPixels(
  img: PNG,
  match: (r: number, g: number, b: number) => boolean,
): number {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (
      img.data[i + 3] > 0 &&
      match(img.data[i], img.data[i + 1], img.data[i + 2])
    ) {
      n++;
    }
  }
  return n;
}

// Bounding box and pixel count of the pixels matching the predicate. The
// offset-path probes below pin the position of a whole painted box, so a
// shifted or rotated box cannot slip through a single lucky sample.
function colorBox(
  img: PNG,
  match: (r: number, g: number, b: number) => boolean,
): { x0: number; y0: number; x1: number; y1: number; n: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (img.width * y + x) * 4;
      if (match(img.data[i], img.data[i + 1], img.data[i + 2])) {
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return n ? { x0, y0, x1, y1, n } : null;
}

const isReddish = (r: number, g: number, b: number) =>
  r > 120 && r - g > 40 && r - b > 40;
const isBluish = (r: number, g: number, b: number) =>
  b > 120 && b - r > 40 && b - g > 40;
const isBlackish = (r: number, g: number, b: number) =>
  r < 100 && g < 100 && b < 100;

// Minimal GIF LZW decoder (variable code size, clear / end codes) for the GIF probe.
function lzwDecode(data: number[], minCode: number): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let bits = minCode + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    bits = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  let prev: number[] | undefined;
  for (const byte of data) {
    acc |= byte << nbits;
    nbits += 8;
    while (nbits >= bits) {
      const code = acc & ((1 << bits) - 1);
      acc >>= bits;
      nbits -= bits;
      if (code === clear) {
        reset();
        prev = undefined;
        continue;
      }
      if (code === eoi) return out;
      let entry: number[];
      if (code < table.length) entry = table[code];
      else if (prev) entry = [...prev, prev[0]];
      else return out;
      out.push(...entry);
      if (prev) table.push([...prev, entry[0]]);
      prev = entry;
      if (table.length === 1 << bits && bits < 12) bits++;
    }
  }
  return out;
}

describe("regression: layout and paint probes", () => {
  it("column flex container with auto height honours min-height (flex-grow fills it)", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;min-height:150px;width:100px">
         <div style="flex:1;background:#00f"></div></div>`,
    );
    expect(near(at(50, 140), BLUE)).toBe(true);
    expect(isWhite(at(50, 160))).toBe(true);
  });

  it("column flex container with auto height honours max-height", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;max-height:80px;width:100px">
         <div style="height:200px;min-height:0;background:#00f"></div></div>`,
    );
    expect(near(at(50, 70), BLUE)).toBe(true);
    expect(isWhite(at(50, 100))).toBe(true);
  });

  it("fixed-height column flex item shrinks to its content minimum", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;height:100px;width:100px">
         <div style="height:300px;background:#00f"></div></div>`,
    );
    expect(near(at(50, 90), BLUE)).toBe(true);
    expect(isWhite(at(50, 120))).toBe(true);
  });

  it("a flex item's auto-width wrapper sizes a width:100% image to the item, not its intrinsic width", async () => {
    // An auto-width block inside a flex item fills the item's content box (597px), so a
    // width:100% image is 597px wide, not its 800px intrinsic width. The min-content
    // contribution of a percentage-width replaced element is 0, which lets flex-shrink
    // bring the item down to the container instead of clamping it at the intrinsic width.
    const svg = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='800' height='450' fill='#e68c28'/></svg>");
    const img = `<img src="${svg}" style="width:100%;display:block;aspect-ratio:800/450">`;
    const { at } = await renderPng(
      `<div style="display:flex;width:597px"><div style="flex:1"><div>${img}</div></div></div>`,
      700,
      500,
    );
    expect(near(at(580, 20), [230, 140, 40], 30)).toBe(true); // inside the 597px-wide image
    expect(isWhite(at(650, 20))).toBe(true); // at the 800px intrinsic width this would be painted
  });

  it("a column flex item's fit-content cross size ignores a cyclic width:100% child", async () => {
    // The flex line measures the item's cross size with content sizing, so the containing
    // block width is indefinite. A width:100% child is cyclic there and must behave as auto
    // (its own content size), not resolve against the 600px available width. Otherwise the
    // item is always as wide as the container and cannot be centred/shrunk. The second case
    // adds the GitHub hero shape: the percentage child is a grid whose fr tracks have to be
    // sized from their spanning item's max-content contribution under the same constraint.
    const blueAt = 300;
    const whiteAt = 50;
    const cases = [
      `<div style="width:100%"><div style="width:200px;height:20px;background:#00f"></div></div>`,
      `<div style="width:100%;display:grid;grid-template-columns:repeat(2,minmax(0px,1fr));column-gap:20px">
         <div style="grid-column:auto / span 2;width:200px;height:20px;background:#00f"></div></div>`,
    ];
    for (const child of cases) {
      const { at } = await renderPng(
        `<div style="display:flex;flex-direction:column;align-items:center;width:600px">
           <div style="padding:0 20px">${child}</div></div>`,
        700,
        60,
      );
      expect(near(at(blueAt, 10), BLUE), child).toBe(true); // item content starts at (600-240)/2+20
      expect(isWhite(at(whiteAt, 10)), child).toBe(true); // no longer painted at the container edge
    }
  });

  it("aspect-ratio gives a replaced element's auto height, overriding the intrinsic ratio", async () => {
    // GitHub's hero media is <img style="width:100%;aspect-ratio:1206/684">. The ratio has to
    // size the box even when the intrinsic ratio differs, and even when the image cannot be
    // decoded at all (an unavailable source has no intrinsic ratio to fall back to).
    // The first image is a transparent 800x450 SVG shown as a 1:1 box (200x200), the second is
    // an undecodable PNG with a 2:1 box (200x100). Both paint their blue background.
    const svg =
      "data:image/svg+xml," +
      encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'></svg>");
    const { at } = await renderPng(
      `<div style="width:200px">
         <img style="display:block;width:100%;aspect-ratio:1/1;background:#00f" src="${svg}" alt="">
         <img style="display:block;width:100%;aspect-ratio:2/1;background:#00f" src="data:image/png;base64,aGVsbG8=" alt="">
       </div>`,
      300,
      400,
    );
    expect(near(at(100, 150), BLUE)).toBe(true); // inside the 1:1 box (112px tall without the fix)
    expect(near(at(100, 250), BLUE)).toBe(true); // inside the 2:1 box (0px tall without the fix)
    expect(isWhite(at(100, 350))).toBe(true); // no stray height below both boxes
  });

  it("radial-gradient(circle <length>) draws and clamps to the last stop outside the radius", async () => {
    const { at } = await renderPng(
      `<div style="width:150px;height:100px;background:radial-gradient(circle 40px,#f00,#00f)"></div>`,
    );
    const [r, , b] = at(75, 50);
    expect(r).toBeGreaterThan(b); // red-ish center
    expect(near(at(5, 5), BLUE, 20)).toBe(true); // beyond the 40px radius
  });

  it("mask-image longhand masks the element", async () => {
    const { at } = await renderPng(
      `<div style="width:100px;height:100px;background:#00f;
         mask-image:linear-gradient(#000 50%,transparent 50%)"></div>`,
    );
    expect(near(at(50, 20), BLUE)).toBe(true);
    expect(isWhite(at(50, 80))).toBe(true);
  });

  it("mask-size tiles the mask image", async () => {
    const { at } = await renderPng(
      `<div style="width:100px;height:100px;background:#00f;
         mask-image:linear-gradient(#000 50%,transparent 50%);mask-size:100px 20px"></div>`,
    );
    expect(near(at(50, 5), BLUE)).toBe(true);
    expect(isWhite(at(50, 15))).toBe(true);
    expect(near(at(50, 25), BLUE)).toBe(true);
    expect(isWhite(at(50, 35))).toBe(true);
  });

  it("display:flow-root contains floats and keeps child margins inside", async () => {
    const { at } = await renderPng(
      `<div style="display:flow-root;background:#00f;width:100px">
         <div style="float:left;width:50px;height:40px;background:#f00"></div>
         <div style="margin-top:20px;height:10px"></div></div>
       <div style="height:10px;background:#0f0;width:100px"></div>`,
      300,
      100,
    );
    expect(near(at(80, 10), BLUE)).toBe(true); // child margin-top stays inside the container
    expect(near(at(10, 30), RED)).toBe(true); // float is inside the container box
    expect(near(at(80, 30), BLUE)).toBe(true); // container grew to the float height (40px)
    expect(near(at(80, 45), [0, 255, 0])).toBe(true); // following block starts after the float
  });

  it("max-lines clamps any block container and block-ellipsis controls the marker", async () => {
    const text = "WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW";
    const row = (img: PNG, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] < 128 && img.data[i + 3] > 0) n++;
        }
      return n;
    };
    const css = "width:100px;font:bold 20px/20px sans-serif;color:#000";
    const free = await renderPng(`<div style="${css}">${text}</div>`, 120, 120);
    const clamped = await renderPng(`<div style="${css};max-lines:2">${text}</div>`, 120, 120);
    const bare = await renderPng(`<div style="${css};max-lines:2;block-ellipsis:no-ellipsis">${text}</div>`, 120, 120);
    expect(row(free.img, 40, 120)).toBeGreaterThan(0);
    expect(row(clamped.img, 40, 120)).toBe(0); // nothing past line 2
    expect(row(clamped.img, 20, 40)).toBeGreaterThan(0);
    expect(row(clamped.img, 20, 40)).not.toBe(row(bare.img, 20, 40)); // ellipsis marker differs
  });

  it("stroke-linejoin shapes the text-stroke corners (miter reaches farther than round)", async () => {
    const renderCase = async (join: string) => {
      const { img } = await renderPng(
        `<div style="font:bold 60px/80px sans-serif;color:#fff;-webkit-text-stroke:8px #000;${join}">W</div>`,
        100,
        90,
      );
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
      return n;
    };
    const round = await renderCase("");
    const miter = await renderCase("stroke-linejoin:miter");
    const bevel = await renderCase("stroke-linejoin:bevel");
    expect(miter).toBeGreaterThan(round);
    expect(bevel).toBeLessThan(round);
  });

  it("clip-rule: evenodd punches the overlap of a self-overlapping clip-path polygon", async () => {
    const poly = "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 25% 25%, 75% 25%, 75% 75%, 25% 75%, 25% 25%)";
    const nonzero = await renderPng(
      `<div style="width:80px;height:80px;background:#00f;clip-path:${poly}"></div>`,
      100,
      100,
    );
    const evenodd = await renderPng(
      `<div style="width:80px;height:80px;background:#00f;clip-path:${poly};clip-rule:evenodd"></div>`,
      100,
      100,
    );
    expect(near(nonzero.at(40, 40), BLUE)).toBe(true);
    expect(isWhite(evenodd.at(40, 40))).toBe(true);
    expect(near(evenodd.at(5, 5), BLUE)).toBe(true);
  });

  it("animated APNG / GIF carry the sampled frames, loop count and valid image data", async () => {
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;
    const animation = { duration: 300, fps: 10, loop: 3 };

    // --- APNG: acTL / fcTL / fdAT chunk structure; plain PNG decoders show frame 0.
    const apng = await render({ value: html, width: 120, height: 120, format: "apng", animation });
    expect(apng.animation).toBe(true);
    const png = Buffer.from(apng.data as Uint8Array);
    const chunks: string[] = [];
    let actl: { frames: number; plays: number } | undefined;
    for (let pos = 8; pos < png.length; ) {
      const len = png.readUInt32BE(pos);
      const type = png.toString("latin1", pos + 4, pos + 8);
      chunks.push(type);
      if (type === "acTL") actl = { frames: png.readUInt32BE(pos + 8), plays: png.readUInt32BE(pos + 12) };
      pos += 12 + len;
    }
    expect(actl?.frames).toBeGreaterThan(1);
    expect(actl?.plays).toBe(3);
    expect(chunks.filter((c) => c === "fcTL").length).toBe(actl!.frames);
    expect(chunks.filter((c) => c === "fdAT").length).toBe(actl!.frames - 1);
    expect(chunks[chunks.length - 1]).toBe("IEND");
    const first = PNG.sync.read(png);
    expect([first.width, first.height]).toEqual([120, 120]);

    // A single frame (no animation option) degrades to a plain PNG.
    const stillPng = await render({ value: html, width: 120, height: 120, format: "apng" });
    expect(stillPng.animation).toBeFalsy();
    expect(Buffer.from(stillPng.data as Uint8Array).includes("acTL")).toBe(false);

    // --- GIF: header, NETSCAPE loop (plays - 1), one image descriptor per frame.
    const gif = await render({ value: html, width: 120, height: 120, format: "gif", animation });
    expect(gif.animation).toBe(true);
    const g = Buffer.from(gif.data as Uint8Array);
    expect(g.toString("latin1", 0, 6)).toBe("GIF89a");
    expect([g.readUInt16LE(6), g.readUInt16LE(8)]).toEqual([120, 120]);
    const tableLen = 3 * (1 << ((g[10] & 7) + 1));
    let pos = 13 + tableLen;
    let loop = -1;
    let frameCount = 0;
    let firstFrame: number[] | undefined;
    while (pos < g.length && g[pos] !== 0x3b) {
      if (g[pos] === 0x21) {
        if (g[pos + 1] === 0xff) loop = g.readUInt16LE(pos + 16);
        pos += 2;
        while (g[pos] !== 0) pos += g[pos] + 1;
        pos += 1;
      } else {
        expect(g[pos]).toBe(0x2c);
        frameCount++;
        const minCode = g[pos + 10];
        pos += 11;
        const data: number[] = [];
        while (g[pos] !== 0) {
          data.push(...g.subarray(pos + 1, pos + 1 + g[pos]));
          pos += g[pos] + 1;
        }
        pos += 1;
        if (!firstFrame) firstFrame = lzwDecode(data, minCode);
      }
    }
    expect(g[g.length - 1]).toBe(0x3b);
    expect(frameCount).toBeGreaterThan(1);
    expect(loop).toBe(2);
    expect(firstFrame?.length).toBe(120 * 120);
    // Frame 0 is fully faded out (opacity 0): white background everywhere.
    const white = firstFrame![60 * 120 + 60];
    expect(firstFrame!.every((v) => v === white)).toBe(true);

    const stillGif = await render({ value: html, width: 120, height: 120, format: "gif" });
    expect(stillGif.animation).toBeFalsy();
    expect(Buffer.from(stillGif.data as Uint8Array).includes("NETSCAPE")).toBe(false);
  });

  it("corner-shape reshapes the border-radius corners of backgrounds and borders", async () => {
    const box = async (shape: string, extra = "") =>
      renderPng(
        `<div style="width:80px;height:80px;background:#00f;border-radius:40px;${shape ? `corner-shape:${shape};` : ""}${extra}"></div>`,
        100,
        100,
      );
    const round = await box("");
    const bevel = await box("bevel");
    const scoop = await box("scoop");
    const notch = await box("notch");
    const squircle = await box("squircle");
    const square = await box("square");
    // (12,12): inside the round arc, outside bevel / scoop / notch.
    expect(near(round.at(12, 12), BLUE)).toBe(true);
    for (const s of [bevel, scoop, notch]) expect(isWhite(s.at(12, 12))).toBe(true);
    // (30,30): only the notch has removed it.
    for (const s of [round, bevel, scoop]) expect(near(s.at(30, 30), BLUE)).toBe(true);
    expect(isWhite(notch.at(30, 30))).toBe(true);
    // (8,8): inside the superellipse but outside the circle.
    expect(isWhite(round.at(8, 8))).toBe(true);
    expect(near(squircle.at(8, 8), BLUE)).toBe(true);
    // `square` keeps the ordinary right-angled corner.
    expect(near(square.at(1, 1), BLUE)).toBe(true);
    // Four values apply per corner (top-left, top-right, bottom-right, bottom-left).
    const mixed = await box("notch round round round");
    expect(isWhite(mixed.at(30, 30))).toBe(true);
    expect(near(mixed.at(70, 30), BLUE)).toBe(true);

    // The border follows the shaped outline: the notched corner has no border either.
    const bordered = await renderPng(
      `<div style="width:72px;height:72px;border:4px solid #f00;background:#00f;border-radius:20px;corner-shape:notch"></div>`,
      100,
      100,
    );
    expect(near(bordered.at(2, 40), RED)).toBe(true); // left edge
    expect(near(bordered.at(40, 2), RED)).toBe(true); // top edge
    expect(isWhite(bordered.at(8, 8))).toBe(true); // notched-out corner
  });

  it("display:table-header-group / table-footer-group rows render and are ordered header-first, footer-last", async () => {
    const cell = (c: string) => `<tr><td style="background:${c};height:30px;width:100px"></td></tr>`;
    const GREEN: Rgb = [0, 255, 0];
    // Explicit header group (used to collapse the whole table to nothing).
    const header = await renderPng(
      `<table style="border-collapse:collapse"><thead style="display:table-header-group">${cell("#f00")}</thead><tbody>${cell("#0f0")}</tbody></table>`,
      200,
      100,
    );
    expect(near(header.at(20, 10), RED)).toBe(true);
    expect(near(header.at(20, 40), GREEN)).toBe(true);
    // The header group comes first and the footer group last whatever the source order.
    const reordered = await renderPng(
      `<table style="border-collapse:collapse"><tfoot style="display:table-footer-group">${cell("#00f")}</tfoot><tbody>${cell("#0f0")}</tbody><thead style="display:table-header-group">${cell("#f00")}</thead></table>`,
      200,
      100,
    );
    expect(near(reordered.at(20, 10), RED)).toBe(true);
    expect(near(reordered.at(20, 40), GREEN)).toBe(true);
    expect(near(reordered.at(20, 70), BLUE)).toBe(true);
    // The same structure built from plain elements.
    const divs = await renderPng(
      `<div style="display:table"><div style="display:table-header-group"><div style="display:table-row"><div style="display:table-cell;background:#f00;height:30px;width:100px"></div></div></div><div style="display:table-row-group"><div style="display:table-row"><div style="display:table-cell;background:#0f0;height:30px"></div></div></div></div>`,
      200,
      100,
    );
    expect(near(divs.at(20, 10), RED)).toBe(true);
    expect(near(divs.at(20, 40), GREEN)).toBe(true);
  });

  it("<col> / <colgroup> backgrounds paint under the table rows", async () => {
    const col = await renderPng(
      `<table style="border-collapse:collapse"><colgroup style="background:#ff0"><col style="background:#f0f;width:60px"><col style="background:#0ff;width:60px"></colgroup><tr><td style="height:30px"></td><td></td></tr><tr><td style="height:30px"></td><td></td></tr></table>`,
      200,
      100,
    );
    expect(near(col.at(20, 10), [255, 0, 255])).toBe(true);
    expect(near(col.at(20, 50), [255, 0, 255])).toBe(true);
    expect(near(col.at(90, 10), [0, 255, 255])).toBe(true);
    expect(isWhite(col.at(20, 80))).toBe(true);
  });

  it("box-decoration-break: clone repaints a complete box on each PDF page; slice is the default", async () => {
    const doc = (style: string, height: number) =>
      `<html><head><style>@page{size:300px 200px;margin:0}</style></head><body style="margin:0">` +
      `<div style="margin:20px;border:6px solid #c00;border-radius:24px;background:#9cf;padding:10px;height:${height}px;${style}">x</div></body></html>`;
    const pdf = async (style: string, height: number) =>
      Buffer.from((await render({ value: doc(style, height), width: 300, format: "pdf" })).data as Uint8Array);

    const plain = await pdf("", 300);
    const slice = await pdf("box-decoration-break:slice", 300);
    const clone = await pdf("box-decoration-break:clone", 300);
    const webkitClone = await pdf("-webkit-box-decoration-break:clone", 300);
    expect(slice.equals(plain)).toBe(true); // slice is the existing behaviour
    expect(clone.equals(plain)).toBe(false); // each fragment is decorated as a whole box
    expect(webkitClone.equals(clone)).toBe(true);

    // A box that fits on one page has no fragments: clone changes nothing.
    const smallPlain = await pdf("", 80);
    const smallClone = await pdf("box-decoration-break:clone", 80);
    expect(smallClone.equals(smallPlain)).toBe(true);
  });

  it("text-fit: shrink / grow scale the font so the widest line fits the container", async () => {
    const extent = async (style: string, text: string) => {
      const { img } = await renderPng(
        `<div style="width:200px;font:bold 40px/50px sans-serif;color:#000;white-space:nowrap;${style}">${text}</div>`,
        400,
        80,
      );
      let max = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] < 128) max = Math.max(max, x);
        }
      return max;
    };
    const long = "Hello World Wide Web";
    expect(await extent("", long)).toBeGreaterThan(250); // overflows without text-fit
    const shrunk = await extent("text-fit:shrink", long);
    expect(shrunk).toBeLessThan(205);
    expect(shrunk).toBeGreaterThan(150); // fitted, not collapsed
    expect(await extent("text-fit:grow", long)).toBeGreaterThan(250); // grow never shrinks
    const short = "Hi";
    expect(await extent("", short)).toBeLessThan(100);
    const grown = await extent("text-fit:grow", short);
    expect(grown).toBeGreaterThan(150);
    expect(grown).toBeLessThan(205);
    expect(await extent("text-fit:shrink", short)).toBeLessThan(100); // shrink never grows
    // A percentage limit bounds the scale (50% of the font size at the least).
    expect(await extent("text-fit:shrink 90%", long)).toBeGreaterThan(shrunk);
  });

  it("<img> decodes JPEG XL (data URL) and image input accepts raw JXL bytes", async () => {
    const jxl = (
      await render({
        value: `<body style="margin:0"><div style="width:40px;height:40px;background:#f00"></div></body>`,
        width: 40,
        height: 40,
        format: "jxl",
        quality: 100,
      })
    ).data as Uint8Array;
    const b64 = Buffer.from(jxl).toString("base64");
    const { at } = await renderPng(
      `<img src="data:image/jxl;base64,${b64}" width="80" height="80">`,
      100,
      100,
    );
    expect(near(at(40, 40), RED)).toBe(true);
    expect(isWhite(at(95, 95))).toBe(true);

    const fromBytes = await render({ value: jxl, width: 40, format: "png" });
    const png = PNG.sync.read(Buffer.from(fromBytes.data as Uint8Array));
    expect([png.width, png.height]).toEqual([40, 40]);
    expect(near([png.data[0], png.data[1], png.data[2]] as Rgb, RED)).toBe(true);
  });

  it("corner-shape: superellipse(), per-corner longhands, box-shadow and dashed borders follow the shape", async () => {
    const box = (style: string, outer = "") =>
      renderPng(
        `<div style="margin:20px;width:80px;height:80px;background:#00f;border-radius:40px;${style}"></div>${outer}`,
        140,
        140,
      );
    // superellipse(1) is a straight bevel, superellipse(2) is the squircle, superellipse(1) != round.
    const bevel = await box("corner-shape:superellipse(0)");
    expect(isWhite(bevel.at(32, 32))).toBe(true); // x+y < radius box diagonal: cut away
    const squircle = await box("corner-shape:squircle");
    const super2 = await box("corner-shape:superellipse(2)");
    expect(near(squircle.at(28, 28), BLUE)).toBe(true);
    expect(near(super2.at(28, 28), BLUE)).toBe(true);
    // Longhands set one corner.
    const longhand = await box("corner-top-left-shape:notch");
    expect(isWhite(longhand.at(30, 30))).toBe(true); // top-left notched
    expect(near(longhand.at(85, 45), BLUE)).toBe(true); // top-right still round
    // Outer box-shadow follows the notch: the shadow is absent where the corner was cut away.
    const shadow = await box("border-radius:20px;corner-shape:notch;box-shadow:0 0 0 6px #f00");
    expect(near(shadow.at(17, 60), RED)).toBe(true); // edge shadow
    expect(isWhite(shadow.at(24, 24))).toBe(true); // notched corner region has neither box nor shadow
    // A dashed border on a shaped box leaves gaps (not a solid ring).
    const dashed = await box("box-sizing:border-box;border:4px dashed #f00;background:none;corner-shape:bevel;border-radius:20px");
    let red = 0;
    let gap = 0;
    for (let x = 28; x < 100; x++) (near(dashed.at(x, 21), RED, 60) ? red++ : gap++);
    expect(red).toBeGreaterThan(5);
    expect(gap).toBeGreaterThan(5);
  });

  it("every @keyframes block animates its own elements (several animations, class selectors)", async () => {
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0.1 } to { opacity: 1 } }
      @keyframes tint { from { background-color: #f00 } to { background-color: #00f } }
      .a { width: 40px; height: 40px; background: #000; animation: fade 400ms infinite; }
      .b { width: 40px; height: 40px; animation: tint 400ms infinite; }
    </style></head><body style="margin:0;background:#fff">
      <div class="a"></div><div class="a" style="margin-top:10px"></div><div class="b" style="margin-top:10px"></div>
    </body></html>`;
    const r = await render({ value: html, width: 60, height: 150, format: "webp", animation: { duration: 400, fps: 10 } });
    expect(r.animation).toBe(true);
    const frames = webpFrameHashes(new Uint8Array(r.data as Uint8Array));
    expect(frames.length).toBeGreaterThan(2);
    // The still render of the first frame already reflects both animations at progress 0.
    const first = await renderFirstFrame(html, 60, 150);
    expect(first.at(10, 10)[0]).toBeGreaterThan(180); // .a faded (10% black over white)
    expect(first.at(10, 60)[0]).toBeGreaterThan(180); // second .a (same keyframes, second element)
    expect(near(first.at(10, 110), RED)).toBe(true); // .b starts red
  });

  it("several animations on one element are layered (shorthand list and longhand lists)", async () => {
    const html = (rule: string) => `<html><head><style>
      @keyframes fade { from { opacity: 0.1 } to { opacity: 1 } }
      @keyframes tint { from { background-color: #f00 } to { background-color: #00f } }
      @keyframes lift { from { transform: translate(0, 0) } to { transform: translate(0, 20px) } }
      .a { width: 40px; height: 40px; margin: 30px 10px 0; background: #000; ${rule} }
    </style></head><body style="margin:0;background:#fff"><div class="a"></div></body></html>`;
    const rules = [
      "animation: fade 400ms infinite, tint 400ms infinite;",
      "animation-name: fade, tint; animation-duration: 400ms, 400ms; animation-iteration-count: infinite;",
    ];
    for (const rule of rules) {
      const first = await renderFirstFrame(html(rule), 80, 120);
      // Both layered: red background at 10% opacity over white = (255, 230, 230). Only fade would
      // give a grey, only tint a saturated red.
      const [r0, g0, b0] = first.at(20, 40);
      expect(r0).toBeGreaterThan(g0 + 10);
      expect(g0).toBeGreaterThan(200);
      expect(b0).toBeGreaterThan(200);
      const r = await render({ value: html(rule), width: 80, height: 120, format: "webp", animation: { duration: 400, fps: 10 } });
      expect(r.animation).toBe(true);
    }
    // A unitless zero is a valid translate length and the element really moves.
    const lift = async (progressRule: string) => {
      const r = await render({ value: html(progressRule), width: 80, height: 120, format: "apng", animation: { duration: 400, fps: 5 } });
      return Buffer.from(r.data as Uint8Array);
    };
    const apng = await lift("animation: lift 400ms infinite;");
    expect(apng.includes("acTL")).toBe(true);
  });

  it("the same @keyframes bound by several rules animates every rule's elements", async () => {
    const html = `<html><head><style>
      @keyframes tint { from { background-color: #f00 } to { background-color: #00f } }
      .a { width: 40px; height: 40px; background: #000; animation: tint 400ms infinite; }
      .wrap .b { width: 40px; height: 40px; margin-top: 10px; background: #000; animation: tint 800ms infinite; }
    </style></head><body style="margin:0;background:#fff">
      <div class="a"></div><div class="wrap"><div class="b"></div></div>
    </body></html>`;
    const first = await renderFirstFrame(html, 60, 100);
    expect(near(first.at(10, 10), RED)).toBe(true); // first rule
    expect(near(first.at(10, 60), RED)).toBe(true); // second rule (used to stay black)
  });

  it("an animated colour reaches nested descendants that inherit it", async () => {
    const html = `<html><head><style>
      @keyframes ink { from { color: #f00 } to { color: #00f } }
      p { margin: 0; font: bold 40px/40px sans-serif; color: #000; animation: ink 400ms infinite; }
      em { font-style: normal; }
    </style></head><body style="margin:0;background:#fff"><p>III<em>III</em></p></body></html>`;
    const { img } = await renderFirstFrame(html, 120, 50);
    let redInEm = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 45; x < 110; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i] > 200 && img.data[i + 1] < 80 && img.data[i + 2] < 80) redInEm++;
      }
    expect(redInEm).toBeGreaterThan(20); // the <em> glyph is red (it used to stay black)
  });

  describe("text controls: align-last, justify, line-break, hyphens, tab-size, overflow:clip, grid, fonts", () => {
    const inkRight = (img: PNG, y0: number, y1: number) => {
      let max = -1;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < img.width; x++) if (img.data[(img.width * y + x) * 4] < 128) max = Math.max(max, x);
      return max;
    };
    const line = async (style: string, text: string, boxWidth: number, tag = "div") => {
      const { img } = await renderPng(
        `<${tag} style="margin:0;width:${boxWidth}px;font:16px/20px sans-serif;color:#000;${style}">${text}</${tag}>`,
        300,
        80,
      );
      return inkRight(img, 0, 20);
    };

    it("text-align-last positions the last line", async () => {
      const left = await line("", "ab cd", 160);
      expect(await line("text-align-last:right", "ab cd", 160)).toBeGreaterThan(left + 80);
      const center = await line("text-align-last:center", "ab cd", 160);
      expect(center).toBeGreaterThan(left + 30);
      expect(center).toBeLessThan(140);
      expect(await line("text-align:justify;text-align-last:justify", "ab cd", 160)).toBeGreaterThan(150);
      expect(await line("text-align:justify", "ab cd", 160)).toBeLessThan(left + 5); // last line stays start-aligned
    });

    it("text-justify: none disables justify, inter-word skips CJK, inter-character spreads it", async () => {
      const t = "aa bb cc dd ee ff gg hh ii jj kk ll mm";
      expect(await line("text-align:justify", t, 130)).toBe(130);
      expect(await line("text-align:justify;text-justify:none", t, 130)).toBeLessThan(125);
      expect(await line("text-align:justify;text-justify:inter-word", t, 130)).toBe(130);
      const cjk = "あいうえおかきくけこさしすせそたちつてと";
      const plain = await line("", cjk, 98);
      expect(await line("text-align:justify;text-justify:inter-word", cjk, 98)).toBe(plain); // no spaces to stretch
      expect(await line("text-align:justify;text-justify:inter-character", cjk, 98)).toBeGreaterThan(plain);
    });

    it("line-break: strict keeps small kana attached, loose allows iteration marks, anywhere breaks Latin", async () => {
      const small = "あいうえゃおかき";
      const mark = "あいうえ々おかき";
      expect(await line("", small, 64)).toBeGreaterThan(55); // small kana may start a line (normal)
      expect(await line("line-break:strict", small, 64)).toBeLessThan(50);
      expect(await line("", mark, 64)).toBeLessThan(50); // iteration mark may not start a line
      expect(await line("line-break:loose", mark, 64)).toBeGreaterThan(55);
      expect(await line("", "abcdefghijklmnop", 64)).toBeGreaterThan(100);
      expect(await line("line-break:anywhere", "abcdefghijklmnop", 64)).toBeLessThan(65);
    });

    it("hyphens / hyphenate-character: a soft hyphen shows a hyphen only at the line end", async () => {
      const wide = await line("", "extra&shy;ordinary", 300);
      expect(wide).toBe(await line("", "extraordinary", 300)); // invisible inside a line
      const broken = await line("hyphens:manual", "extra&shy;ordinary", 70);
      expect(broken).toBe(await line("", "extra-ordinary", 70)); // hyphen drawn after "extra"
      const none = await line("hyphens:none", "extra&shy;ordinary", 70);
      expect(none).toBeLessThan(broken); // no hyphen shown
      expect(await line("-webkit-hyphens:none", "extra&shy;ordinary", 70)).toBe(none);
      // hyphenate-character replaces the hyphen
      const star = await line("hyphenate-character:'**'", "extra&shy;ordinary", 70);
      expect(star).toBeGreaterThan(broken);
      // hyphens: auto hyphenates English words (lang=en) at the line end
      const auto = await renderPng(
        `<div lang="en" style="margin:0;width:60px;font:16px/20px sans-serif;color:#000;hyphens:auto">extraordinary</div>`,
        120,
        80,
      );
      expect(inkRight(auto.img, 0, 20)).toBeLessThan(62); // wrapped onto several lines
      const noLang = await renderPng(
        `<div style="margin:0;width:60px;font:16px/20px sans-serif;color:#000;hyphens:auto">extraordinary</div>`,
        120,
        80,
      );
      expect(inkRight(noLang.img, 0, 20)).toBeGreaterThan(90); // no lang: no automatic hyphenation
    });

    it("tab-size sets the tab stop width (number of spaces or a length)", async () => {
      const tab = (style: string) => line(`white-space:pre;font-family:monospace;${style}`, "a\tb", 300);
      const d = await tab("");
      expect(await tab("tab-size:2")).toBeLessThan(d - 20);
      expect(await tab("tab-size:40px")).toBeLessThan(d);
      expect(await tab("tab-size:40px")).toBeGreaterThan(40);
    });

    it("overflow: clip clips like hidden", async () => {
      const { at } = await renderPng(
        `<div style="width:50px;height:20px;overflow:clip"><div style="width:200px;height:20px;background:#00f"></div></div>`,
        200,
        60,
      );
      expect(near(at(40, 10), BLUE)).toBe(true);
      expect(isWhite(at(80, 10))).toBe(true);
    });

    it("grid-template / grid shorthands expand to the longhands", async () => {
      const cell = (c: string) => `<div style="background:${c}"></div>`;
      const cells = cell("#f00") + cell("#0f0") + cell("#00f") + cell("#ff0");
      const a = await renderPng(`<div style="display:grid;grid-template:60px 40px / 100px 80px">${cells}</div>`, 200, 120);
      expect(near(a.at(10, 10), RED)).toBe(true);
      expect(near(a.at(150, 10), [0, 255, 0])).toBe(true);
      expect(near(a.at(10, 80), BLUE)).toBe(true);
      expect(near(a.at(150, 80), [255, 255, 0])).toBe(true);
      expect(isWhite(a.at(190, 10))).toBe(true); // columns are 100 + 80
      // template areas with row sizes
      const areas = await renderPng(
        `<div style="display:grid;grid:'h h' 30px 'm s' 50px / 60px 90px;">
           <div style="grid-area:h;background:#f00"></div><div style="grid-area:m;background:#0f0"></div><div style="grid-area:s;background:#00f"></div></div>`,
        200,
        120,
      );
      expect(near(areas.at(140, 10), RED)).toBe(true); // header spans both columns
      expect(near(areas.at(10, 50), [0, 255, 0])).toBe(true);
      expect(near(areas.at(100, 50), BLUE)).toBe(true);
      // grid: auto-flow
      const flow = await renderPng(
        `<div style="display:grid;grid:auto-flow 30px / 50px 50px">${cells}</div>`,
        200,
        120,
      );
      expect(near(flow.at(10, 10), RED)).toBe(true);
      expect(near(flow.at(70, 10), [0, 255, 0])).toBe(true);
      expect(near(flow.at(10, 40), BLUE)).toBe(true);
    });

    it("font-synthesis: none stops the synthetic bold / italic", async () => {
      const ink = async (style: string) => {
        // The regular-only Noto Sans JP as fallback: the default (variable) one would stand in
        // for the synthetic bold with a real bold.
        const { data } = await render({
          value: `<html><body style="margin:0;background:#fff"><div style="font:bold italic 40px/50px 'RobotoProbe';color:#000;${style}">HHH</div><style>${PROBE_FONT_FACE}</style></body></html>`,
          width: 200,
          height: 60,
          format: "png",
          fontMap: { "sans-serif": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP" },
        });
        const img = PNG.sync.read(Buffer.from(data));
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
        return n;
      };
      const full = await ink("");
      const noWeight = await ink("font-synthesis:none");
      expect(noWeight).toBeLessThan(full);
      expect(await ink("font-synthesis-weight:none;font-synthesis-style:none")).toBe(noWeight);
      expect(await ink("font-synthesis:weight style")).toBe(full); // both allowed again
    });

    it("font-optical-sizing drives the opsz axis from the font size; none keeps the default", async () => {
      const OPSZ_FACE =
        "@font-face{font-family:'RobotoOpsz';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.3.0/files/roboto-flex-latin-opsz-normal.woff2') format('woff2')}";
      const width = async (style: string) => {
        const { img } = await renderPng(
          `<style>${OPSZ_FACE}</style><div style="margin:0;font:40px/50px 'RobotoOpsz';color:#000;white-space:nowrap;${style}">Handgloves</div>`,
          500,
          60,
        );
        return inkRight(img, 0, 50);
      };
      const auto = await width("");
      const none = await width("font-optical-sizing:none");
      expect(auto).not.toBe(none);
      // An explicit opsz in font-variation-settings wins over font-optical-sizing.
      expect(await width("font-variation-settings:'opsz' 144")).toBe(await width("font-variation-settings:'opsz' 144;font-optical-sizing:none"));
    });
  });

  it("PNG output of an image with at most 256 colors is stored indexed and decodes identically", async () => {
    const colorType = (b: Uint8Array) => Buffer.from(b)[25];
    const flat = await render({
      value: `<body style="margin:0;background:#fff"><div style="width:40px;height:40px;background:#f00"></div><div style="width:40px;height:20px;background:#00f"></div></body>`,
      width: 100,
      height: 80,
      format: "png",
    });
    expect(colorType(flat.data as Uint8Array)).toBe(3); // indexed
    const png = PNG.sync.read(Buffer.from(flat.data as Uint8Array));
    const at = (x: number, y: number) => Array.from(png.data.slice((png.width * y + x) * 4, (png.width * y + x) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 0, 0, 255]);
    expect(at(10, 50)).toEqual([0, 0, 255, 255]);
    expect(at(90, 70)).toEqual([255, 255, 255, 255]);

    // A transparent background keeps its alpha through tRNS.
    const alpha = await render({
      value: `<body style="margin:0"><div style="width:40px;height:40px;background:rgba(255,0,0,0.5)"></div></body>`,
      width: 100,
      height: 80,
      format: "png",
    });
    expect(colorType(alpha.data as Uint8Array)).toBe(3);
    const ap = PNG.sync.read(Buffer.from(alpha.data as Uint8Array));
    const a0 = (x: number, y: number) => Array.from(ap.data.slice((ap.width * y + x) * 4, (ap.width * y + x) * 4 + 4));
    expect(a0(90, 70)[3]).toBe(0);
    expect(a0(10, 10)[0]).toBe(255);
    expect(Math.abs(a0(10, 10)[3] - 128)).toBeLessThanOrEqual(1);

    // More than 256 colors (gradient) stays RGBA.
    const rich = await render({
      value: `<body style="margin:0"><div style="width:300px;height:80px;background:linear-gradient(135deg,#f00,#0f0 50%,#00f)"></div></body>`,
      width: 300,
      height: 80,
      format: "png",
    });
    expect(colorType(rich.data as Uint8Array)).not.toBe(3); // RGB or RGBA
  });

  it("opacity layers are bounded to the subtree but never clip what it paints outside its box", async () => {
    // Shadow outside the box.
    const shadow = await renderPng(
      `<div style="margin:40px;width:40px;height:40px;background:#00f;opacity:.5;box-shadow:0 0 20px 6px #f00"></div>`,
      200,
      140,
    );
    expect(isWhite(shadow.at(34, 60))).toBe(false); // 6px left of the box: shadow, not clipped
    expect(near(shadow.at(60, 60), [128, 128, 255], 40)).toBe(true); // half-transparent blue
    // Text overflowing a narrow box.
    const overflow = await renderPng(
      `<div style="margin:10px;width:30px;height:30px;opacity:.5;white-space:nowrap;font:bold 30px/30px sans-serif;color:#000">WWWWWWWW</div>`,
      300,
      60,
    );
    let inkRight = 0;
    for (let x = 100; x < 300; x++) for (let y = 0; y < 60; y++) if (!isWhite(overflow.at(x, y))) inkRight++;
    expect(inkRight).toBeGreaterThan(50); // text past the 30px box is still painted
    // Own transform: the layer follows the moved element.
    const moved = await renderPng(
      `<div style="margin:10px;width:40px;height:40px;background:#00f;opacity:.5;transform:translate(100px,20px)"></div>`,
      200,
      100,
    );
    expect(near(moved.at(130, 50), [128, 128, 255], 40)).toBe(true);
    expect(isWhite(moved.at(30, 30))).toBe(true);
    // Rotation reaches outside the unrotated box.
    const rotated = await renderPng(
      `<div style="margin:50px;width:60px;height:20px;background:#00f;opacity:.5;transform:rotate(90deg)"></div>`,
      200,
      200,
    );
    expect(near(rotated.at(80, 30), [128, 128, 255], 40)).toBe(true); // top of the rotated bar
    // A transformed descendant cannot be bounded: still painted.
    const child = await renderPng(
      `<div style="margin:20px;width:40px;height:40px;opacity:.5"><div style="width:40px;height:40px;background:#00f;transform:translate(80px,0)"></div></div>`,
      200,
      100,
    );
    expect(near(child.at(120, 40), [128, 128, 255], 40)).toBe(true);
  });

  it("float margin box (not the border box) narrows the first line", async () => {
    const squares = '<i style="display:inline-block;width:16px;height:16px;background:#00f"></i>'.repeat(30);
    const { at } = await renderPng(
      `<div style="width:240px;font-size:0;line-height:16px">
         <div style="float:right;width:60px;height:60px;background:#f00;margin:4px"></div>${squares}</div>`,
      300,
      100,
    );
    expect(near(at(150, 8), BLUE)).toBe(true); // 10th square fits left of the margin box (x < 172)
    expect(isWhite(at(165, 8))).toBe(true); // an 11th square would cross into the margin
  });

  it("table cellspacing/cellpadding attributes override the UA defaults", async () => {
    const { at } = await renderPng(
      `<table cellspacing="0" cellpadding="0"><tr>
         <td style="width:20px;height:20px;background:#00f"></td><td style="width:20px;height:20px;background:#f00"></td>
       </tr></table>
       <table cellspacing="0" cellpadding="6" style="margin-top:10px"><tr>
         <td style="background:#00f"><i style="display:block;width:10px;height:10px;background:#0f0"></i></td></tr></table>`,
      200,
      120,
    );
    expect(near(at(19, 10), BLUE)).toBe(true); // first cell ends at x=20
    expect(near(at(21, 10), [255, 0, 0])).toBe(true); // no 2px spacing gap before the next cell
    // second table starts at y=30: 6px padding around a 10px child -> 22px cell
    expect(near(at(3, 36), BLUE)).toBe(true); // padding area is the cell background
    expect(near(at(11, 41), [0, 255, 0])).toBe(true); // child sits inside the padding
  });

  it("calc() in a media query neither crashes nor mismatches", async () => {
    const css = `<style>.a{width:50px;height:50px}
      @media (max-width:calc(500px - 1px)){.a{background:#00f}}
      @media (min-width:calc(500px + 1px)){.a{background:#f00}}</style><div class="a"></div>`;
    const narrow = await renderPng(css, 400, 80);
    expect(near(narrow.at(10, 10), BLUE)).toBe(true);
    const wide = await renderPng(css, 700, 80);
    expect(near(wide.at(10, 10), [255, 0, 0])).toBe(true);
  });

  it("a bitmap too large to allocate fails the render without killing the instance", async () => {
    const huge = `<html><body style="margin:0"><div style="height:1200000px;background:#eee"></div></body></html>`;
    await expect(render({ value: huge, width: 1000, format: "png" })).rejects.toThrow();
    const { at } = await renderPng(`<div style="width:50px;height:50px;background:#00f"></div>`, 100, 60);
    expect(near(at(10, 10), BLUE)).toBe(true);
  });

  it("valign attributes on tr and td place cell content at the top", async () => {
    const { at } = await renderPng(
      `<table cellspacing="0" cellpadding="0"><tr valign="top">
         <td><i style="display:block;width:10px;height:10px;background:#00f"></i></td>
         <td><i style="display:block;width:10px;height:100px;background:#888"></i></td>
       </tr></table>
       <table cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>
         <td valign="top"><i style="display:block;width:10px;height:10px;background:#00f"></i></td>
         <td><i style="display:block;width:10px;height:100px;background:#888"></i></td>
       </tr></table>`,
      100,
      260,
    );
    expect(near(at(5, 5), BLUE)).toBe(true); // tr valign=top
    expect(near(at(5, 125), BLUE)).toBe(true); // td valign=top (second table starts at y=120)
    expect(isWhite(at(5, 60))).toBe(true); // not vertically centered
  });

  it("<center> centers block-level tables and divs", async () => {
    const { at } = await renderPng(
      `<center><table width="50%" cellspacing="0" cellpadding="0"><tr><td style="height:20px;background:#00f"></td></tr></table>
       <div style="width:100px;height:20px;background:#f00"></div></center>`,
      400,
      60,
    );
    expect(isWhite(at(90, 10))).toBe(true);
    expect(near(at(110, 10), BLUE)).toBe(true); // table spans x=100..299
    expect(isWhite(at(140, 30))).toBe(true);
    expect(near(at(160, 30), [255, 0, 0])).toBe(true); // div spans x=150..249
  });

  it("<body bgcolor> and <body background> presentational attributes apply", async () => {
    const solid = await render({
      value: `<html><body bgcolor="#0000ff"><div style="height:20px"></div></body></html>`,
      width: 100,
      height: 60,
      format: "png",
    });
    const sImg = PNG.sync.read(Buffer.from(solid.data));
    expect([sImg.data[(50 * sImg.width + 50) * 4], sImg.data[(50 * sImg.width + 50) * 4 + 2]]).toEqual([0, 255]);

    const tile = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23f00'/%3E%3C/svg%3E";
    const textured = await render({
      value: `<html><body style="margin:0" background="${tile}"><div style="height:20px"></div></body></html>`,
      width: 100,
      height: 60,
      format: "png",
    });
    const tImg = PNG.sync.read(Buffer.from(textured.data));
    const i = (50 * tImg.width + 50) * 4;
    expect([tImg.data[i], tImg.data[i + 1]]).toEqual([255, 0]);
  });

  it("grid content-sized tracks (auto, max-content, fit-content, minmax) and blockified inline items", async () => {
    const cell = (c: string) => `<span style="background:${c};display:inline-block;width:60px;height:10px"></span>`;
    const widths = async (tpl: string) => {
      const { at } = await renderPng(
        `<div style="display:grid;grid-template-columns:${tpl};width:300px">${cell("#f00")}${cell("#00f")}</div>`,
        320,
        20,
      );
      // first x where the pixel stops being red (width of column 1 as drawn by the red item)
      let x = 0;
      while (x < 300 && at(x, 5)[0] > 200 && at(x, 5)[2] < 60) x++;
      return { redEnd: x, blueAtRedEnd: near(at(x + 1, 5), BLUE) };
    };
    for (const tpl of ["auto 1fr", "max-content 1fr", "fit-content(200px) 1fr"]) {
      const r = await widths(tpl);
      expect(r.redEnd, tpl).toBe(60);
      expect(r.blueAtRedEnd, tpl).toBe(true);
    }
    // minmax(<length>, <length>) is not content-sized: the free space grows the track to its
    // maximum (Chromium: columns 200px 100px, so the second item starts at x=200).
    {
      const { at } = await renderPng(
        `<div style="display:grid;grid-template-columns:minmax(0,200px) 1fr;width:300px">${cell("#f00")}${cell("#00f")}</div>`,
        320,
        20,
      );
      expect(near(at(210, 5), BLUE)).toBe(true);
      expect(near(at(190, 5), BLUE)).toBe(false);
    }
    // inline children of a grid container become grid items (one per cell, not overlapped)
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:fit-content(200px) 1fr;font-size:10px;line-height:10px">
         <time style="background:#f00;color:#f00">AAAA</time><a style="background:#00f;color:#00f">BBBB</a></div>`,
      200,
      20,
    );
    expect(near(at(5, 5), [255, 0, 0])).toBe(true);
    expect(near(at(30, 5), BLUE)).toBe(true);
  });

  it("percentage heights against an auto-height parent behave as auto", async () => {
    const html = `<html><body style="margin:0;background:#fff"><div style="background:#00f"><div style="height:100%;min-height:100%;background:#00f;color:#00f;font-size:10px;line-height:10px">x</div></div></body></html>`;
    const r = await render({ value: html, width: 100, format: "png" });
    expect(r.height).toBeLessThan(100); // was the 3000px initial viewport height
  });

  it("inline SVG <mask> renders by luminance instead of aborting the wasm instance", async () => {
    const svg = (mask: string) =>
      `<svg width="50" height="50"><mask id="m">${mask}</mask><rect width="50" height="50" fill="#00f" mask="url(#m)"/></svg>`;
    const half = await renderPng(svg(`<rect width="25" height="50" fill="#fff"/>`), 100, 60);
    expect(near(half.at(10, 25), BLUE)).toBe(true); // white (luma 1) keeps the content
    expect(isWhite(half.at(40, 25))).toBe(true); // unmasked area is transparent
    const gray = await renderPng(svg(`<rect width="50" height="50" fill="#808080"/>`), 100, 60);
    const [r] = gray.at(25, 25);
    expect(r).toBeGreaterThan(100); // ~50% mask: blue blended with the white page
    expect(r).toBeLessThan(160);
  });

  it("closed <details> hides everything but its summary; open shows it", async () => {
    const body = (open: string) =>
      `<details${open}><summary style="height:20px;background:#00f"></summary><div style="height:200px;background:#f00"></div></details>`;
    const closed = await render({ value: `<html><body style="margin:0">${body("")}</body></html>`, width: 100, format: "png" });
    expect(closed.height).toBeLessThan(60);
    const opened = await render({ value: `<html><body style="margin:0">${body(" open")}</body></html>`, width: 100, format: "png" });
    expect(opened.height).toBeGreaterThan(200);
  });
  it("grid named lines, grid-template-areas and grid-area place items", async () => {
    const g = (style: string, items: string) =>
      `<div style="display:grid;width:300px;height:100px;${style}">${items}</div>`;
    const areas = await renderPng(
      g(
        "grid-template-areas:'header header' 'side main';grid-template-columns:100px 1fr;grid-template-rows:40px 1fr",
        `<div style="grid-area:header;background:#f00"></div><div style="grid-area:side;background:#00f"></div><div style="grid-area:main;background:#0f0"></div>`,
      ),
      320,
      100,
    );
    expect(near(areas.at(250, 10), RED)).toBe(true);
    expect(near(areas.at(10, 80), BLUE)).toBe(true);
    expect(near(areas.at(250, 80), [0, 255, 0])).toBe(true);
    const lines = await renderPng(
      g(
        "--c:[a] 100px [b] 1fr [c];grid-template-columns:var(--c)",
        `<div style="grid-column:b / c;grid-row:1;background:#f00"></div><div style="grid-column:a / b;grid-row:1;background:#00f"></div>`,
      ),
      320,
      100,
    );
    expect(near(lines.at(250, 10), RED)).toBe(true);
    expect(near(lines.at(10, 10), BLUE)).toBe(true);
  });
  it("overflow accepts two values and per-axis longhands, and clips", async () => {
    for (const style of ["overflow:hidden auto", "overflow-x:hidden;overflow-y:auto", "overflow-y:hidden"]) {
      const { at } = await renderPng(
        `<div style="height:40px;${style}"><div style="height:200px;background:#f00"></div></div>`,
        100,
        120,
      );
      expect(near(at(5, 20), RED)).toBe(true);
      expect(isWhite(at(5, 100))).toBe(true); // clipped below the 40px box
    }
  });

  it("calc() resolves viewport units mixed with lengths", async () => {
    const body = (h: string) => `<div style="max-height:${h}"><div style="height:100px"></div></div><div style="height:10px"></div>`;
    const r = await render({ value: `<html><body style="margin:0">${body("calc(-48px + 100vh)")}</body></html>`, width: 100, format: "png" });
    expect(r.height).toBe(110); // a dropped vh term made max-height negative and collapsed the box
  });

  it("vh resolves against the default viewport height, not the layout canvas", async () => {
    // With `height` omitted the layout canvas used to be 3000px tall, so vh/vmin/vmax
    // resolved against 3000 instead of a browser-like viewport. Chromium (no-JS viewport
    // 1000x800) resolves 25vh to 0.25 * 800 = 200px.
    const vh = await render({
      value: `<html><body style="margin:0"><div style="height:25vh;background:#c00"></div></body></html>`,
      width: 1000,
      format: "png",
    });
    expect(vh.height).toBe(200); // was 750 (0.25 * 3000)
    // example.com's body{ padding-top:25vh } must sit ~200px down, not 750px.
    const pad = await render({
      value: `<html><body style="margin:0;padding:25vh 0 0 0"><p style="margin:0">x</p></body></html>`,
      width: 1000,
      format: "png",
    });
    expect(pad.height).toBeGreaterThanOrEqual(200); // at least the 25vh padding alone
    expect(pad.height).toBeLessThan(280); // Chromium's content is ~224px (was 773)
  });

  it("an absolutely positioned inline-flex box is blockified out of the line box", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:flex;width:300px"><h1 style="margin:0;font-size:16px">Title text here</h1><div><input type="checkbox" style="position:absolute;display:inline-flex;width:100%;height:100%"></div></div></body></html>`,
      width: 300,
      format: "png",
    });
    expect(r.height).toBeLessThan(30); // the heading stayed on one line
  });
  it("auto-width table with percentage cells is shrink-to-fit, not collapsed", async () => {
    const cell = (w: string) => `<td style="width:${w}">先代<br>東京府・東京市</td>`;
    for (const font of ["", "font-size:95%;"]) {
      const r = await render({
        value: `<html><body style="margin:0"><table style="border-collapse:collapse;margin:0.5em auto;${font}"><tr style="text-align:center">${cell("30%")}${cell("40%")}${cell("30%")}</tr></table></body></html>`,
        width: 800,
        format: "png",
      });
      expect(r.height).toBeLessThan(80); // text stayed on two lines instead of one character per line
    }
  });
  it("inline SVG keeps its height attribute after a style refresh (table sibling, width:100%)", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="#eee"/></svg>`;
    const r = await render({
      value: `<html><head><style>svg{width:100%}</style></head><body style="margin:0"><figure style="display:table;margin:0"><img width="500" height="100" style="display:block"></figure><div>${svg}</div></body></html>`,
      width: 952,
      format: "png",
    });
    expect(r.height).toBe(700); // the height attribute was dropped and replaced by a 6:1 aspect ratio (5800px)
  });
  it("inline SVG resolves var() to its fallback in attributes and style", async () => {
    for (const attr of [`fill="var( --x, #f00 )"`, `style="fill:var(--x,#f00)"`, `fill="var(--x, rgb(255,0,0))"`]) {
      const { at } = await renderPng(`<svg width="100" height="40"><rect width="100" height="40" ${attr}/></svg>`, 100, 40);
      expect(near(at(50, 20), RED)).toBe(true);
    }
  });
  it("inline SVG <text> is drawn (needs a font manager that knows Satoru's fonts)", async () => {
    const { img } = await renderPng(
      `<svg width="200" height="40"><text x="5" y="25" font-size="16" fill="#000">Hello 世田谷区</text></svg>`,
      200,
      40,
    );
    let dark = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0 && img.data[i] < 128) dark++;
    expect(dark).toBeGreaterThan(100);
  });
  it("deeply nested flex-wrap trees finish in bounded time (layout work budget)", async () => {
    const nest = (d: number): string =>
      d === 0
        ? "<button>x</button>"
        : `<div style="display:flex;flex-wrap:wrap"><div style="flex:100%;max-width:100%;display:flex;flex-wrap:wrap">${nest(d - 1)}<span>a</span></div></div>`;
    const t0 = Date.now();
    const r = await render({ value: `<html><body>${nest(16)}</body></html>`, width: 600, format: "png" });
    expect(r.height).toBeGreaterThan(100);
    expect(Date.now() - t0).toBeLessThan(30000); // exponential before: minutes at this depth
  }, 60000);
  it("closed <dialog> is hidden; open <dialog> is shown", async () => {
    const body = (open: string) => `<dialog${open}><div style="height:200px;background:#f00"></div></dialog><div style="height:10px"></div>`;
    const closed = await render({ value: `<html><body style="margin:0">${body("")}</body></html>`, width: 100, format: "png" });
    expect(closed.height).toBeLessThan(40);
    const opened = await render({ value: `<html><body style="margin:0">${body(" open")}</body></html>`, width: 100, format: "png" });
    expect(opened.height).toBeGreaterThan(200);
  });
  it("multicol splits a list's items across columns instead of keeping the list in one column", async () => {
    const li = Array.from({ length: 10 }, (_, i) => `<li style="height:30px">r ${i}</li>`).join("");
    for (const style of ["column-count:2", "column-width:200px"]) {
      const r = await render({
        value: `<html><body style="margin:0"><div style="${style}"><ol style="margin:0">${li}</ol></div></body></html>`,
        width: 600,
        format: "png",
      });
      expect(r.height).toBe(150); // 10 items x 30px in 2 balanced columns (was 300 in one column)
    }
  });
  it("deeply nested auto tables keep a sane height (no stale sizes from the measure budget)", async () => {
    // Wikipedia-style navbox: th{width:1%} + td{width:100%} tables nested a dozen levels deep.
    const leaf = "<ul><li><a>item one</a></li><li><a>item two</a></li></ul>";
    let inner = leaf;
    for (let i = 0; i < 12; i++) {
      inner = `<table style="width:100%;border-spacing:0"><tbody><tr><th style="width:1%;white-space:nowrap">G${i}</th><td style="width:100%;padding:0">${inner}</td></tr><tr><td colspan="2" style="padding:0">${leaf}</td></tr></tbody></table>`;
    }
    const r = await render({ value: `<html><body style="margin:0;font:14px sans-serif"><div style="width:600px">${inner}</div></body></html>`, width: 700, format: "png" });
    expect(r.height).toBeLessThan(1500); // ~12 x (list 2 rows) rows; was inflated by the exhausted budget
  }, 60000);
  it("text inputs get a default box (size, border) instead of collapsing to nothing", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><input type="text" style="display:block"><input style="display:block"></body></html>`,
      width: 300,
      format: "png",
    });
    expect(r.height).toBe(42); // 2 x 21px default control height
  });
  it("input value / placeholder / button label text is drawn", async () => {
    const draw = async (attrs: string) =>
      Buffer.from((await render({ value: `<html><body style="margin:0"><input ${attrs}></body></html>`, width: 200, format: "png" })).data).toString("base64");
    const empty = await draw('type="text"');
    expect(await draw('type="text" value="WWWW"')).not.toBe(empty);
    expect(await draw('type="text" placeholder="WWWW"')).not.toBe(empty);
    expect(await draw('type="submit" value="WWWW"')).not.toBe(await draw('type="submit" value=""'));
  });
  it("textarea, select and checkbox/radio get default boxes; size/cols/rows are honored", async () => {
    const h = async (body: string) => (await render({ value: `<html><body style="margin:0;font:14px sans-serif">${body}</body></html>`, width: 600, format: "png" })).height;
    expect(await h('<textarea style="display:block"></textarea>')).toBe(36); // rows=2 default
    expect(await h('<textarea rows="5" style="display:block"></textarea>')).toBe(81);
    expect(await h('<select style="display:block"><option>One</option><option>Two</option></select>')).toBeGreaterThan(15);
    expect(await h('<input type="checkbox" style="display:block;margin:0">')).toBe(13);
  });
  it("grid: definite column with auto row is auto-placed into a free row", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:repeat(24,1fr);column-gap:8px;width:960px"><div style="grid-column:1 / span 16;height:100px"></div><div style="grid-column:17 / span 8;grid-row:1 / span 3;height:100px"></div><div style="grid-column:1 / span 1;height:50px"></div></div></body></html>`,
      width: 960,
      format: "png",
    });
    expect(r.height).toBe(150); // third item goes to row 2 (was drawn over the first at 100)
  });
  it("grid inside a grid sizes its rows from content (items are not forced to the track height)", async () => {
    const h2 = `<h2 style="margin:0;font:18px/22px serif;background:#f00">Bollywood actor Tiger Shroff survives shooting in Mumbai</h2>`;
    const p = `<p style="margin:0;font:14px/18px serif;background:#00f">Video published by several news outlets shows gunmen firing multiple shots at a car</p>`;
    const { at } = await renderPng(`<div style="width:312px;display:grid"><div style="display:grid">${h2}${p}</div></div>`, 312, 140);
    // the blue paragraph must start below the (two-line) red title, not overlap it
    let redBottom = -1;
    let blueTop = -1;
    for (let y = 0; y < 140; y++) {
      const c = at(3, y);
      if (near(c, RED)) redBottom = y;
      if (near(c, BLUE) && blueTop < 0) blueTop = y;
    }
    expect(blueTop).toBeGreaterThan(redBottom);
  });
  it("explicit grid-template-rows tracks keep their specified size; items overflow instead", async () => {
    // `display:grid;grid-template-rows:50px` with a 200px tall (overflow:hidden) item:
    // Chromium keeps the grid 50px tall and clips the item. An explicitly sized row track
    // must not be grown to its item's content.
    const doc = (rows: string) =>
      `<div style="display:grid;grid-template-rows:${rows};width:160px"><div style="overflow:hidden"><div style="height:200px;background:#00f"></div></div></div><div style="height:20px;background:#0f0"></div>`;
    const fixed = await renderPng(doc("50px"), 200, 300);
    expect(near(fixed.at(5, 25), BLUE)).toBe(true);
    expect(near(fixed.at(5, 49), BLUE)).toBe(true);
    // the marker is right below the 50px track, not below the 200px item (y=220 before the fix)
    expect(near(fixed.at(5, 55), [0, 255, 0])).toBe(true);
    expect(isWhite(fixed.at(5, 75))).toBe(true);
    // `0fr` in an indefinite-height container stays collapsed (GitHub accordion panels).
    const collapsed = await renderPng(doc("0fr"), 200, 300);
    expect(near(collapsed.at(5, 15), [0, 255, 0])).toBe(true);
    expect(isWhite(collapsed.at(5, 25))).toBe(true);
  });
  it("grid items are auto-placed in order-modified document order", async () => {
    // `order` reorders grid items for placement (CSS Grid §8.5 runs auto-placement in
    // order-modified document order), so the red order:2 item is pushed to the second
    // column although it comes first in the DOM (GitHub accordion wrapper/visual swap).
    const swapped = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px;width:200px"><div style="order:2;height:40px;background:#f00"></div><div style="order:1;height:40px;background:#00f"></div></div>`,
      300,
      100,
    );
    expect(near(swapped.at(50, 20), BLUE)).toBe(true);
    expect(near(swapped.at(150, 20), RED)).toBe(true);
    // Items sharing an `order` keep their DOM order.
    const same = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px;width:200px"><div style="order:1;height:40px;background:#f00"></div><div style="order:1;height:40px;background:#00f"></div></div>`,
      300,
      100,
    );
    expect(near(same.at(50, 20), RED)).toBe(true);
    expect(near(same.at(150, 20), BLUE)).toBe(true);
  });
  it("negative vertical margins overlap instead of adding space", async () => {
    // Adjoining margins collapse to the largest positive plus the most negative one
    // (CSS 2.1 §8.3.1); before the fix the negative part was pushed the box *down*
    // (GitHub's `.lp-Cta-mascots-wrap{margin-top:-10%;margin-bottom:-10%}`).
    const h = async (body: string) =>
      (await render({ value: `<html><body style="margin:0">${body}</body></html>`, width: 300, format: "png" })).height;
    // Chromium: 100 + 100 - 100 + 10 = 110 (the blue box overlaps the red one).
    expect(
      await h(
        `<div style="height:100px;background:#f00"></div><div style="height:100px;background:#00f;margin-top:-100px"></div><div style="height:10px;background:#0f0"></div>`,
      ),
    ).toBe(110);
    // 20px bottom + -5px top collapse to 15px: 50 + 20 + 15 + 20 = 105.
    expect(
      await h(
        `<div style="height:50px"></div><div style="height:20px;margin-bottom:20px"></div><div style="height:20px;margin-top:-5px"></div>`,
      ),
    ).toBe(105);
    // A negative first-child margin pulls the content up: 40 - 10 + 10 = 40.
    expect(await h(`<div style="height:40px;background:#00f;margin-top:-10px"></div><div style="height:10px;background:#0f0"></div>`)).toBe(40);
  });
  it("aspect-ratio:unset / initial cancel an earlier aspect-ratio", async () => {
    // GitHub resets `aspect-ratio:1` with a doubled-class rule
    // (`.lp-SectionHero-content.lp-SectionHero-content{aspect-ratio:unset}`). Before the
    // fix the keyword was dropped, the ratio survived and the 1000px-wide hero became
    // 1000px tall instead of sizing from its content.
    const doc = (kw: string) =>
      `<style>.box{width:200px;aspect-ratio:1;background:#f00}.box.box{aspect-ratio:${kw}}.box>div{height:30px;background:#00f}</style>` +
      `<div class="box"><div></div></div><div style="height:10px;background:#0f0"></div>`;
    const height = async (kw: string) =>
      (await render({ value: `<html><body style="margin:0">${doc(kw)}</body></html>`, width: 300, format: "png" })).height;
    // Chromium: content 30px + marker 10px. Without the reset the box keeps 1:1 (200px).
    expect(await height("unset")).toBe(40);
    expect(await height("initial")).toBe(40);
    expect(await height("auto")).toBe(40);
    // `unset` inherits on inherited properties, `initial` does not.
    const inherited = await renderPng(
      `<style>.p{color:#f00}.u{color:unset;border:10px solid;width:40px;height:20px;background:#00f}.i{color:initial;border:10px solid;width:40px;height:20px;background:#00f}</style>` +
        `<div class="p"><div class="u"></div><div class="i"></div></div>`,
      300,
      100,
    );
    expect(near(inherited.at(5, 5), RED)).toBe(true); // color:unset -> inherited red border
    expect(near(inherited.at(20, 45), RED)).toBe(false); // color:initial -> initial colour, not the parent's
  });
  it("display:contents generates no box: its children take part in the parent's layout", async () => {
    const h = async (b: string) => (await render({ value: `<html><body style="margin:0">${b}</body></html>`, width: 400, format: "png" })).height;
    expect(
      await h(`<div style="display:grid;grid-template-columns:100px 100px;width:400px"><div style="display:contents"><div style="height:30px">a</div><div style="height:30px">b</div><div style="height:40px">c</div></div></div>`),
    ).toBe(70); // a,b share row 1; c is row 2
    expect(await h(`<div style="display:flex"><div style="display:contents"><div style="height:30px;width:50px">a</div><div style="height:50px;width:50px">b</div></div></div>`)).toBe(50);
  });
  it("resolves relative stylesheets against the post-redirect final URL", async () => {
    // A 301 to another path must move the base used for relative resources:
    // otherwise `style.css` is requested against the stale URL and 404s.
    const html = `<html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div class="box"></div></body></html>`;
    const css = `.box{width:120px;height:80px;background:#00f}`;
    const server = http.createServer((req, res) => {
      if (req.url === "/old") {
        res.writeHead(301, { location: "/base/final.html" });
        res.end();
      } else if (req.url === "/base/final.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/base/style.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(css);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/old`,
        width: 200,
        height: 120,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(60, 40), BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("an unlayered declaration in a fetched stylesheet beats a layered one from inline CSS", async () => {
    // <link rel=stylesheet> content is page CSS (author origin, unlayered). Injecting it as
    // a user stylesheet made every @layer block outrank it, so a losing `padding:var(...)`
    // inside `@layer` won over the linked `padding:0 var(--gap)` (github.com hero, +128px).
    const html = `<html><head><link rel="stylesheet" href="page.css"><style>
      @layer brand { :root { --pad: 120px 0 } .box { padding: var(--pad) } }
    </style></head><body style="margin:0;background:#fff"><div class="box"><div style="height:20px;background:#f00"></div></div></body></html>`;
    const css = `:root{--gap:24px}.box{padding:0 var(--gap)}`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/page.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(css);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 300,
        height: 200,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      // padding:0 24px -> the child paints from the top, 24px in from the left.
      expect(near(at(10, 10), [255, 255, 255])).toBe(true);
      expect(near(at(30, 10), RED)).toBe(true);
      // The layered 120px padding-top must not win: no red left below row ~20.
      expect(near(at(30, 100), [255, 255, 255])).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sampled @keyframes opacity animation yields a multi-frame animated WebP", async () => {
    // The document carries the animation; `animation: { duration, fps }` asks
    // the renderer to sample it into frames (loop fixed to infinite, opacity
    // only). Without the option the same document is a single static frame.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrameHashes(
      new Uint8Array(animated.data as Uint8Array),
    );
    expect(frames.length).toBeGreaterThan(1);
    // Fade frames must have distinct pixel content (style override + paint
    // sync applied), not just distinct frame metadata.
    expect(new Set(frames).size).toBe(frames.length);

    const still = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
    });
    expect(still.animation).toBeFalsy();
    expect(webpFrameHashes(new Uint8Array(still.data as Uint8Array))).toEqual(
      [],
    );
  });

  it("animated WebP loops infinitely by default and keeps the legacy bytes at speed 5", async () => {
    // The libwebp `WebPAnimEncoder` path replaced Skia's `EncodeAnimated`.
    // With the default loop / background (loop_count 0, opaque white) and libwebp
    // method 3 (speed 5; the default speed 6 is method 2, a faster encode) the
    // output must stay byte-identical to Skia's, so the hash below pins that.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      speed: 5,
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const data = new Uint8Array(animated.data as Uint8Array);
    const params = webpAnimParams(data);
    expect(params).not.toBeNull();
    // 0 = infinite loop, 0xFFFFFFFF = opaque white canvas background.
    expect(params?.loopCount).toBe(0);
    expect(params?.bgcolor).toBe(0xffffffff);
    expect(sha256(data)).toBe(
      "4ecc75ff99acf161a95eded90a3022ef6de1905fbb100f78a9fbe1ddb1b36164",
    );
  });

  it("animation.loop writes a finite loop count into the ANIM chunk", async () => {
    // `loop: 1` = play once. Only the ANIM chunk differs from the infinite
    // variant: the frames (count, durations, pixels) stay the same.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const infinite = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    const once = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10, loop: 1 },
    });
    expect(once.animation).toBe(true);

    const infiniteData = new Uint8Array(infinite.data as Uint8Array);
    const onceData = new Uint8Array(once.data as Uint8Array);
    expect(webpAnimParams(infiniteData)?.loopCount).toBe(0);
    expect(webpAnimParams(onceData)?.loopCount).toBe(1);
    // The frame payload is untouched by the loop count.
    expect(webpFrames(onceData)).toEqual(webpFrames(infiniteData));
    expect(onceData.byteLength).toBe(infiniteData.byteLength);
  });

  it("animation.loop accepts a repeat count and clamps negative values", async () => {
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const three = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10, loop: 3 },
    });
    expect(
      webpAnimParams(new Uint8Array(three.data as Uint8Array))?.loopCount,
    ).toBe(3);

    // A negative count is meaningless: it falls back to the infinite default.
    const negative = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10, loop: -5 },
    });
    expect(
      webpAnimParams(new Uint8Array(negative.data as Uint8Array))?.loopCount,
    ).toBe(0);
  });

  it("sampled @keyframes transform animation moves the element across the frames", async () => {
    // The box slides from x=60 to x=0. Without the transform sampling the
    // document is static, so no frame is produced at all.
    const html = `<html><head><style>
      @keyframes move { from { transform: translate(60px, 0px) } to { transform: translate(0px, 0px) } }
      .box { width: 40px; height: 40px; background: #00f; animation-name: move; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    // The first sampled frame (progress 0) paints the box at its transformed
    // place, not at its static one.
    const first = await renderFirstFrame(html, 120, 60);
    expect(near(first.at(70, 20), BLUE)).toBe(true);
    expect(isWhite(first.at(30, 20))).toBe(true);

    const animated = await render({
      value: html,
      width: 120,
      height: 60,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    // Every sampled frame carries different pixel content.
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(3);
    // The box really moves: the stored (changed) region follows it to the
    // left - x=60..100 for the first step, x=40..80 for the second one.
    expect(frames[1].x + frames[1].width).toBeGreaterThan(96);
    expect(frames[1].x + frames[1].width).toBeLessThan(104);
    expect(frames[2].x + frames[2].width).toBeGreaterThan(76);
    expect(frames[2].x + frames[2].width).toBeLessThan(84);
  });

  it("sampled @keyframes color animation recolours the element across the frames", async () => {
    // `border-color: currentColor` follows the animated `color`, so the probe
    // needs no font rendering.
    const html = `<html><head><style>
      @keyframes tint { from { color: #ff0000 } to { color: #0000ff } }
      .box { width: 40px; height: 40px; border: 4px solid currentColor; animation-name: tint; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    // The first sampled frame (progress 0) paints the border red; the static
    // document keeps the default (black) colour.
    const first = await renderFirstFrame(html, 120, 60);
    expect(countPixels(first.img, isReddish)).toBeGreaterThan(50);
    expect(countPixels(first.img, isBlackish)).toBe(0);
    expect(countPixels(first.img, isBluish)).toBe(0);

    const animated = await render({
      value: html,
      width: 120,
      height: 60,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(3);
  });

  it("sampled @keyframes background-color animation recolours the background across the frames", async () => {
    const html = `<html><head><style>
      @keyframes tint { from { background-color: #ff0000 } to { background-color: #0000ff } }
      .box { width: 40px; height: 40px; background: #00f; animation-name: tint; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const first = await renderFirstFrame(html, 120, 60);
    expect(countPixels(first.img, isReddish)).toBeGreaterThan(50);
    expect(countPixels(first.img, isBlackish)).toBe(0);
    expect(countPixels(first.img, isBluish)).toBe(0);

    const animated = await render({
      value: html,
      width: 120,
      height: 60,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(3);
  });

  it("resolves var() in @keyframes stop values", async () => {
    // The stop value of the `from` keyframe is a custom property: the
    // binding layer resolves it against the document before the stops are
    // built. Without the resolution the `from` stop is dropped, every
    // frame paints the same opacity and the output is a still image.
    const html = `<html><head><style>
      :root { --from-opacity: 0; }
      @keyframes fade { from { opacity: var(--from-opacity) } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(3);
  });

  it("resolves var() in a @keyframes transform stop value", async () => {
    const html = `<html><head><style>
      :root { --from-x: 0px; }
      @keyframes move { from { transform: translate(var(--from-x), 0px) } to { transform: translate(100px, 0px) } }
      .box { width: 40px; height: 40px; background: #00f; animation-name: move; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 60,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    expect(new Set(frames.map((frame) => frame.hash)).size).toBe(3);
  });

  it("uses the CSS animation-duration as the loop length", async () => {
    // The CSS value wins over the duration requested through the API as
    // long as it is shorter: the sampled frames cover 100ms, not 1000ms.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation: fade 100ms infinite; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 1000, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBeGreaterThan(1);
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
    expect(total).toBe(100);
  });

  it("clamps a longer CSS animation-duration to the requested duration", async () => {
    // The API duration is an upper bound: a 2s CSS duration is sampled as
    // 300ms, so the output keeps the requested length.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation: fade 2s infinite; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(3);
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
    expect(total).toBe(300);
  });

  it("resolves a var() animation-duration", async () => {
    const html = `<html><head><style>
      :root { --dur: 100ms; }
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation: fade var(--dur) infinite; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 1000, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBeGreaterThan(1);
    const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
    expect(total).toBe(100);
  });

  it("applies a per-keyframe animation-timing-function to the eased interval", async () => {
    // A negative delay starts the first sampled frame (progress 0) halfway
    // through the 300ms iteration, so the still frame shows the midpoint of
    // the eased interval: 0.5 blue over white is rgb(128,128,255).
    const fadeDoc = (fromExtra: string, boxExtra = "") =>
      `<html><head><style>
      @keyframes fade { from { opacity: 0; ${fromExtra} } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade;
             animation-duration: 300ms; animation-delay: -150ms; ${boxExtra} }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const linear = await renderFirstFrame(fadeDoc("animation-timing-function: linear"), 120, 120);
    expect(near(linear.at(40, 40), [128, 128, 255], 20)).toBe(true);

    // ease-in is slower than linear at the midpoint (y ~= 0.32 => R ~= 174).
    const eased = await renderFirstFrame(fadeDoc("animation-timing-function: ease-in"), 120, 120);
    expect(eased.at(40, 40)[0]).toBeGreaterThan(155);

    // step-start jumps to the end value immediately: the midpoint is opaque.
    const stepped = await renderFirstFrame(fadeDoc("animation-timing-function: step-start"), 120, 120);
    expect(near(stepped.at(40, 40), BLUE)).toBe(true);

    // The element-level timing function is the default of the stops...
    const elementDefault = await renderFirstFrame(
      fadeDoc("", "animation-timing-function: ease-in;"),
      120,
      120,
    );
    expect(elementDefault.at(40, 40)[0]).toBeGreaterThan(155);

    // ...and a keyframe block overrides it for the interval it starts.
    const overridden = await renderFirstFrame(
      fadeDoc("animation-timing-function: linear", "animation-timing-function: ease-in;"),
      120,
      120,
    );
    expect(near(overridden.at(40, 40), [128, 128, 255], 20)).toBe(true);
  });

  it("honours animation-direction: reverse on the first sampled frame", async () => {
    // The box slides from x=0 to x=60. Reversed, the first sampled frame
    // (progress 0) already shows the 100% stop: the box sits at x=60.
    const html = `<html><head><style>
      @keyframes move { from { transform: translate(0px, 0px) } to { transform: translate(60px, 0px) } }
      .box { width: 40px; height: 40px; background: #00f; animation-name: move;
             animation-direction: reverse; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const first = await renderFirstFrame(html, 120, 60);
    expect(near(first.at(70, 20), BLUE)).toBe(true);
    expect(isWhite(first.at(10, 20))).toBe(true);
  });

  it("honours animation-direction: alternate across the iteration boundary", async () => {
    // duration 100ms x 2 iterations = a 200ms timeline, sampled at 20fps:
    // t = 0 / 50 / 100 / 150 -> progress 0 / 0.5 / 1 / 0.5. The second
    // iteration plays backwards, so the last frame repeats the second one.
    // Opacity keeps the changed rectangle identical, so the frame hashes of
    // the two 0.5 frames are comparable.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade;
             animation-duration: 100ms; animation-iteration-count: 2;
             animation-direction: alternate; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 2000, fps: 20 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.length).toBe(4);
    expect(frames[1].hash).toBe(frames[3].hash);
    expect(frames[0].hash).not.toBe(frames[2].hash);
  });

  it("honours animation-iteration-count as the sampled timeline length", async () => {
    // Three 100ms iterations sample 300ms in total (the API duration is only
    // an upper bound), instead of the single 100ms iteration.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade;
             animation-duration: 100ms; animation-iteration-count: 3; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 1000, fps: 30 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrames(new Uint8Array(animated.data as Uint8Array));
    expect(frames.reduce((sum, frame) => sum + frame.duration, 0)).toBe(300);
    // Three 100ms iterations at 30fps: nine samples whose frames replay the
    // same fade three times (the same within-iteration transition repeats).
    expect(frames.length).toBe(9);
    expect(frames[1].hash).toBe(frames[4].hash);
    expect(frames[2].hash).toBe(frames[5].hash);
  });

  it("paints the backwards fill during animation-delay", async () => {
    // The 100ms delay is not covered by fill-mode none: the element keeps its
    // static (opaque) style. A backwards fill paints the from value (opacity 0).
    const delayDoc = (fill: string) => `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade;
             animation-duration: 100ms; animation-delay: 100ms;
             animation-fill-mode: ${fill}; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const none = await renderFirstFrame(delayDoc("none"), 120, 120);
    expect(near(none.at(40, 40), BLUE)).toBe(true);

    const backwards = await renderFirstFrame(delayDoc("backwards"), 120, 120);
    expect(isWhite(backwards.at(40, 40))).toBe(true);

    // forwards: after the 150ms active part of the 0.5-iteration timeline the
    // final value is kept. `both` therefore paints three identical (from)
    // frames followed by the filled one; `none` paints the static style on
    // every frame, which collapses into a still image.
    const sampleDoc = (fill: string) => `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade;
             animation-duration: 100ms; animation-delay: 100ms;
             animation-iteration-count: 0.5; animation-fill-mode: ${fill}; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const both = await render({
      value: sampleDoc("both"),
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 20 },
    });
    expect(both.animation).toBe(true);
    const bothFrames = webpFrames(new Uint8Array(both.data as Uint8Array));
    expect(bothFrames.length).toBe(2);
    expect(bothFrames[0].duration).toBe(150);

    const noFill = await render({
      value: sampleDoc("none"),
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 20 },
    });
    // Without a forwards fill the element snaps back to its static style after
    // the active interval, which adds a third (static) frame.
    const noFillFrames = webpFrames(new Uint8Array(noFill.data as Uint8Array));
    expect(noFillFrames.length).toBe(3);
    expect(noFillFrames.reduce((sum, frame) => sum + frame.duration, 0)).toBe(200);
  });

  it("unicode-bidi: bidi-override reorders inline items in an RTL line", async () => {

    const box = (color: string, text: string) =>
      `<span style="display:inline-block;width:20px;height:20px;color:transparent;background:${color}">${text}</span>`;
    const { at } = await renderPng(
      `<div style="direction:rtl;unicode-bidi:bidi-override;width:100px;font:10px/10px monospace;white-space:nowrap">${box("#f00", "A")}${box("#00f", "B")}</div>`,
      100,
      40,
    );
    // Both runs are forced to the RTL embedding level, so the line is mirrored:
    // the blue item comes first even though it is last in the source.
    expect(near(at(65, 10), BLUE)).toBe(true);
    expect(near(at(85, 10), RED)).toBe(true);
  });

  it("white-space-collapse: preserve-breaks preserves newlines", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="width:100px;font:16px/20px monospace;white-space-collapse:preserve-breaks">ab\ncd</div></body></html>`,
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(40); // was one collapsed line (20px)
  });

  it("text-wrap-mode: nowrap suppresses wrapping", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="width:50px;font:16px/20px monospace;text-wrap-mode:nowrap">AAAA BBBB</div></body></html>`,
      width: 50,
      format: "png",
    });
    expect(r.height).toBe(20); // was two lines (40px)
  });

  // text-wrap-style: balance / pretty. Chromium narrows the wrap width until the
  // line count would grow, which evens out the line lengths (balance) and pulls
  // an orphaned last word up (pretty). Both must keep the line count, otherwise
  // the following content would move.
  const WRAP_PROBE_TEXT =
    "The quick brown fox jumps over the lazy dog and then keeps on running";
  const wrapProbe = (wrap: string, width: number) =>
    renderProbeText(
      `<div style="width:${width}px;font-family:'RobotoProbe',sans-serif;font-size:16px;line-height:22px;color:#000;${wrap}">${WRAP_PROBE_TEXT}</div>`,
      width,
    );

  it("text-wrap-style: balance evens out the line lengths without adding a line", async () => {
    const auto = lineRightEdges(await wrapProbe("", 300), 22);
    const balanced = lineRightEdges(
      await wrapProbe("text-wrap-style:balance", 300),
      22,
    );

    expect(auto.length).toBe(2);
    expect(balanced.length).toBe(auto.length); // line count is preserved
    // The last line used to keep the short tail (a 67px spread, last line ~35px
    // shorter than the first one) instead of growing to the balanced width.
    expect(lineEdgeSpread(auto)).toBeGreaterThan(50);
    expect(lineEdgeSpread(balanced)).toBeLessThan(30);
    expect(balanced[1]).toBeGreaterThan(auto[1] + 20);
  });

  it("text-wrap-style: pretty pulls an orphaned last word onto the previous line", async () => {
    const auto = lineRightEdges(await wrapProbe("", 240), 22);
    const pretty = lineRightEdges(
      await wrapProbe("text-wrap-style:pretty", 240),
      22,
    );

    expect(auto.length).toBe(3);
    expect(auto[2]).toBeLessThan(80); // the orphan ("running") alone on line 3
    expect(pretty.length).toBe(auto.length); // line count is preserved
    expect(pretty[2]).toBeGreaterThan(auto[2] + 60); // 2+ words on the last line
  });

  it("text-wrap-style is not applied when the flow is out of scope (atomic inline)", async () => {
    // A replaced inline (here: a 20px square) leaves the normal wrapping in
    // place, so the line lengths match the auto render exactly.
    const square =
      "<img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23f00'/%3E%3C/svg%3E\">";
    const text = WRAP_PROBE_TEXT.replace("fox", `${square}fox`);
    const renderWith = (wrap: string) =>
      renderProbeText(
        `<div style="width:300px;font-family:'RobotoProbe',sans-serif;font-size:16px;line-height:22px;color:#000;${wrap}">${text}</div>`,
        300,
      );
    expect(lineRightEdges(await renderWith("text-wrap-style:balance"), 22)).toEqual(
      lineRightEdges(await renderWith(""), 22),
    );
  });

  it("overflow-wrap: break-word moves a word that fits a line instead of splitting it", async () => {
    // "happens" fits a whole line, so it must move there as a unit. The engine
    // split every word into characters and then filled the line to its pixel
    // edge, cutting the word ("... building hap" / "pens together").
    const doc = (wrap: string) =>
      `<div style="width:400px;font-family:'RobotoProbe',sans-serif;font-size:32px;line-height:40px;color:#000;${wrap}">The future of building <span style="color:#f00">happens</span> together</div>`;
    const redInRows = (img: PNG, from: number, to: number) => {
      let count = 0;
      for (let y = from; y < to; y++)
        for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) count++;
      return count;
    };
    // Split the two lines anywhere between them; the probe font may or may not be
    // available, so the exact line box height is not part of the assertion.
    const split = (img: PNG) => Math.floor(img.height / 2);

    const broken = await renderProbeText(doc("overflow-wrap:break-word"), 400);
    expect(broken.height).toBeGreaterThan(60); // two lines, not one
    expect(broken.height).toBeLessThan(100); // not three
    expect(redInRows(broken, 0, split(broken))).toBe(0); // no part of "happens" on line 1
    expect(redInRows(broken, split(broken), broken.height)).toBeGreaterThan(0);

    // anywhere still breaks inside the word to fill the line.
    const anywhere = await renderProbeText(doc("overflow-wrap:anywhere"), 400);
    expect(redInRows(anywhere, 0, split(anywhere))).toBeGreaterThan(0);
  });

  it("grid-auto-rows sizes implicit rows", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:40px;grid-template-rows:10px;grid-auto-rows:40px;width:40px;font-size:0">
        <div style="height:0"></div><div style="height:0"></div><div style="height:0"></div></div></body></html>`,
      width: 40,
      format: "png",
    });
    expect(r.height).toBe(90); // 10 + 40 + 40; implicit rows used to be content-sized
  });

  it("grid-auto-columns sizes columns for explicitly placed items past the template", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:40px;grid-auto-columns:60px;width:200px;height:20px">
         <div style="grid-column:2 / 3;background:#00f"></div>
         <div style="grid-column:3 / 4;background:#0f0"></div>
       </div>`,
      200,
      20,
    );
    expect(near(at(60, 10), BLUE)).toBe(true); // first implicit column spans 40..100
    expect(near(at(110, 10), [0, 255, 0])).toBe(true); // second spans 100..160
    expect(isWhite(at(170, 10))).toBe(true); // no phantom fourth column
  });

  it("grid-auto-flow: row dense backfills holes left by spanning items", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:40px 40px;grid-auto-flow:row dense;grid-auto-rows:20px;width:80px">
        <div style="background:#f00"></div>
        <div style="grid-column:span 2;background:#00f"></div>
        <div style="background:#0f0"></div></div></body></html>`,
      width: 80,
      format: "png",
    });
    expect(r.height).toBe(40); // the third item fills row 1's free cell; sparse put it on row 3
  });

  it("grid-auto-flow: column places items down each column before moving right", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-auto-flow:column;grid-template-rows:20px 20px;grid-auto-columns:30px;width:90px">
         <div style="background:#f00"></div><div style="background:#00f"></div>
         <div style="background:#0f0"></div><div style="background:#ff0"></div>
         <div style="background:#f0f"></div>
       </div>`,
      120,
      60,
    );
    expect(near(at(15, 10), RED)).toBe(true); // col 0, row 0
    expect(near(at(15, 30), BLUE)).toBe(true); // col 0, row 1
    expect(near(at(45, 10), [0, 255, 0])).toBe(true); // col 1, row 0
    expect(near(at(45, 30), [255, 255, 0])).toBe(true); // col 1, row 1
    expect(near(at(75, 10), [255, 0, 255])).toBe(true); // col 2, row 0
  });

  it("grid-auto-flow: column dense backfills holes in a column", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-auto-flow:column dense;grid-template-rows:20px 20px;grid-auto-columns:30px;width:120px">
         <div style="background:#00f"></div>
         <div style="grid-row:span 2;background:#f00"></div>
         <div style="background:#0f0"></div>
       </div>`,
      150,
      60,
    );
    expect(near(at(15, 10), BLUE)).toBe(true);
    expect(near(at(45, 10), RED)).toBe(true); // the 2-row item wraps to column 1
    expect(near(at(45, 30), RED)).toBe(true);
    expect(near(at(15, 30), [0, 255, 0])).toBe(true); // dense fills the hole; sparse put it in column 2
  });

  it("grid-auto-flow: column sizes auto-placement implicit columns from grid-auto-columns", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-auto-flow:column;grid-template-rows:20px;grid-auto-columns:25px 35px;width:200px">
         <div style="background:#f00"></div><div style="background:#00f"></div>
         <div style="background:#0f0"></div>
       </div>`,
      200,
      40,
    );
    expect(near(at(10, 10), RED)).toBe(true); // 0..25
    expect(near(at(30, 10), BLUE)).toBe(true); // 25..60
    expect(near(at(70, 10), [0, 255, 0])).toBe(true); // 60..85 (second auto-columns value)
    expect(isWhite(at(100, 10))).toBe(true); // no phantom track
  });

  it("font-feature-settings applies OpenType features (kern off changes AV spacing)", async () => {
    const base = await renderProbeText(probeLine("", "AVAVAVAVAV"));
    const off = await renderProbeText(
      probeLine("font-feature-settings:'kern' 0", "AVAVAVAVAV"),
    );
    expect(off.data.equals(base.data)).toBe(false);
  });

  it("font-variant-ligatures: none disables common ligatures", async () => {
    const base = await renderProbeText(probeLine("", "office ffi fl"));
    const none = await renderProbeText(
      probeLine("font-variant-ligatures:none", "office ffi fl"),
    );
    expect(none.data.equals(base.data)).toBe(false);
  });

  it("font-variant-numeric longhands select figure sets", async () => {
    const base = await renderProbeText(probeLine("", "1111111111"));
    const proportional = await renderProbeText(
      probeLine("font-variant-numeric:proportional-nums", "1111111111"),
    );
    const tabular = await renderProbeText(
      probeLine("font-variant-numeric:tabular-nums", "1111111111"),
    );
    expect(proportional.data.equals(base.data)).toBe(false);
    expect(proportional.data.equals(tabular.data)).toBe(false);
  });

  it("font-feature-settings is resolved per element (font cache key includes features)", async () => {
    const img = await renderProbeText(
      probeLine("", "AVAVAVAVAV") + probeLine("font-feature-settings:'kern' 0", "AVAVAVAVAV"),
    );
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    // Same text in both lines; only the second line has kerning disabled.
    expect(row(45).equals(row(135))).toBe(false);
  });

  it("font-kerning: none turns the kern feature off, normal keeps it on", async () => {
    const base = await renderProbeText(probeLine("", "AVAVAVAVAV"));
    const none = await renderProbeText(
      probeLine("font-kerning:none", "AVAVAVAVAV"),
    );
    const normal = await renderProbeText(
      probeLine("font-kerning:normal", "AVAVAVAVAV"),
    );
    // Without kerning the AV pairs are not tightened any more.
    expect(none.data.equals(base.data)).toBe(false);
    expect(none.data.equals(normal.data)).toBe(false);
    // The font kerns by itself, so `normal` looks like the initial value.
    expect(normal.data.equals(base.data)).toBe(true);
  });

  it("font-kerning is resolved per element (font cache key includes the feature)", async () => {
    const img = await renderProbeText(
      probeLine("", "AVAVAVAVAV") + probeLine("font-kerning:none", "AVAVAVAVAV"),
    );
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    expect(row(45).equals(row(135))).toBe(false);
  });

  it("font-variation-settings sets an axis of a variable font", async () => {
    const base = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    const heavy = await renderProbeText(
      probeLine("font-variation-settings:'wght' 900", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    // The wght axis moves the glyphs to the heavy instance.
    expect(heavy.data.equals(base.data)).toBe(false);
  });

  it("font-variation-settings ignores an axis the font does not have", async () => {
    const base = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    const unknown = await renderProbeText(
      probeLine("font-variation-settings:'xxxx' 900", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    const heavy = await renderProbeText(
      probeLine("font-variation-settings:'wght' 900", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    // The variable font is really used (the wght axis changes it) and the
    // unknown axis is ignored.
    expect(heavy.data.equals(base.data)).toBe(false);
    expect(unknown.data.equals(base.data)).toBe(true);
  });

  it("font-variation-settings is resolved per element (font cache key includes the axes)", async () => {
    const img = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoVar'") +
        probeLine("font-variation-settings:'wght' 900", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    expect(row(45).equals(row(135))).toBe(false);
  });

  it("font-stretch sets the width axis of a variable font", async () => {
    const base = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    const condensed = await renderProbeText(
      probeLine("font-stretch:75%", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    const expanded = await renderProbeText(
      probeLine("font-stretch:expanded", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    // The wdth axis is set from the requested width.
    expect(condensed.data.equals(base.data)).toBe(false);
    expect(expanded.data.equals(base.data)).toBe(false);
    expect(condensed.data.equals(expanded.data)).toBe(false);
  });

  it("font-stretch is resolved per element (font cache key includes the width)", async () => {
    const img = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoFlex'") +
        probeLine("font-stretch:75%", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    expect(row(45).equals(row(135))).toBe(false);
  });

  it("font-stretch picks the face of the family with the matching width", async () => {
    const regular = await renderProbeText(
      probeLine("", "Handgloves", "'StretchRegular'"),
      800,
      REGULAR_FONT_FACE,
    );
    const condensed = await renderProbeText(
      probeLine("", "Handgloves", "'StretchCondensed'"),
      800,
      CONDENSED_FONT_FACE,
    );
    // The family holds a regular and a condensed face; the stretch has to pick
    // the face with the matching width.
    const pairCondensed = await renderProbeText(
      probeLine("font-stretch:condensed", "Handgloves", "'StretchPair'"),
      800,
      STRETCH_PAIR_FONT_FACE,
    );
    const pairExpanded = await renderProbeText(
      probeLine("font-stretch:125%", "Handgloves", "'StretchPair'"),
      800,
      STRETCH_PAIR_FONT_FACE,
    );
    expect(pairCondensed.data.equals(condensed.data)).toBe(true);
    expect(pairExpanded.data.equals(regular.data)).toBe(true);
    expect(pairCondensed.data.equals(regular.data)).toBe(false);
  });

  it("image-rendering: pixelated keeps scaled images unfiltered (img and background)", async () => {
    // 2x1 source: pure red then pure blue. Upscaled, nearest sampling preserves a hard
    // boundary at the halfway point; the default linear filter blends across it.
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const url = "data:image/png;base64," + PNG.sync.write(png).toString("base64");

    const img = await renderPng(
      `<img src="${url}" style="display:block;width:100px;height:100px;image-rendering:pixelated">`,
    );
    expect(near(img.at(49, 50), RED, 4)).toBe(true);
    expect(near(img.at(50, 50), BLUE, 4)).toBe(true);

    const bg = await renderPng(
      `<div style="width:100px;height:100px;image-rendering:pixelated;
         background-image:url('${url}');background-size:100px 100px;background-repeat:no-repeat"></div>`,
    );
    expect(near(bg.at(49, 50), RED, 4)).toBe(true);
    expect(near(bg.at(50, 50), BLUE, 4)).toBe(true);
  });

  it("offset-path: ray() + offset-distance translates the box along the ray", async () => {
    // offset-position: auto puts the ray origin at the element's top-left; the anchor
    // (offset-anchor: auto => transform-origin) is the box centre, so the box slides so
    // its centre lands on the ray point at 100px to the right.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset-path:ray(90deg);offset-position:auto;offset-distance:100px"></div>`,
    );
    expect(near(at(100, 5), RED)).toBe(true); // centre moved from (10,10) to (100,0)
    expect(isWhite(at(10, 10))).toBe(true); // original location is empty
  });

  it("offset-path: path() places the box at offset-distance along the path", async () => {
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset-path:path('M 0 0 L 200 0');offset-distance:50px"></div>`,
    );
    expect(near(at(50, 5), RED)).toBe(true); // centre at (50,0)
    expect(isWhite(at(10, 10))).toBe(true);
  });

  it("offset-rotate: auto rotates the box along the path direction", async () => {
    // ray(180deg) points down, so auto rotate is +90deg. A 40x20 box becomes 20x40.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:20px;background:#f00;
         offset-path:ray(180deg);offset-position:auto;offset-distance:0px;offset-rotate:auto"></div>`,
    );
    expect(near(at(5, 10), RED)).toBe(true); // rotated box covers x[-10,10]
    expect(isWhite(at(30, 5))).toBe(true); // would be red if it stayed unrotated
  });

  it("offset shorthand sets offset-path and offset-distance", async () => {
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset:path('M 0 0 L 200 0') 60px"></div>`,
    );
    expect(near(at(60, 5), RED)).toBe(true); // centre at (60,0)
    expect(isWhite(at(10, 10))).toBe(true);
  });

  it("offset shorthand rejects an offset-rotate before the path", async () => {
    // The first declaration is valid; the second one has its components out of
    // order (rotate before path), so the whole declaration must be dropped and
    // the first one must keep applying. If the invalid declaration were
    // partially applied, the 40x8 box would additionally be rotated by 30deg.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:8px;background:#f00;
         offset:path('M 0 0 L 200 0') 60px;
         offset:30deg path('M 0 0 L 200 0') 60px"></div>`,
    );
    expect(near(at(60, 2), RED)).toBe(true); // still at distance 60 on the path
    expect(isWhite(at(60, 8))).toBe(true); // a 30deg rotation would cover this
  });

  it("offset shorthand rejects a repeated offset-distance", async () => {
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset:path('M 0 0 L 200 0') 60px;
         offset:path('M 0 0 L 120 0') 20px 30px"></div>`,
    );
    expect(near(at(60, 5), RED)).toBe(true); // first declaration still wins
    expect(isWhite(at(20, 5))).toBe(true); // would be red if 20px reset the distance
  });

  it("offset shorthand rejects an offset-position after the path", async () => {
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset:path('M 0 0 L 200 0') 60px;
         offset:path('M 0 0 L 120 0') center"></div>`,
    );
    expect(near(at(60, 2), RED)).toBe(true); // first declaration still wins
    expect(isWhite(at(0, 2))).toBe(true); // would be red if the path reset to 0
  });

  it("offset shorthand parses leading lengths as offset-position", async () => {
    // The two lengths are the offset-position, not distances. With the ray origin
    // at (100,100), distance 20 lands the centre at (120,100). If the first length
    // were taken as the distance, the origin would stay the default (150,0) and
    // the centre would be at (250,0).
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset:100px 100px ray(90deg) 20px"></div>`,
    );
    expect(near(at(120, 100), RED)).toBe(true);
    expect(isWhite(at(250, 100))).toBe(true);
  });

  it("offset-rotate: an explicit 0deg angle suppresses the tangent rotation", async () => {
    // ray(180deg) points down, so `auto` would rotate the box by +90deg. An explicit
    // 0deg must keep the box axis-aligned even though the angle value is zero.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:20px;background:#f00;
         offset-path:ray(180deg);offset-position:auto;offset-distance:100px;offset-rotate:0deg"></div>`,
    );
    expect(near(at(0, 100), RED)).toBe(true); // unrotated box covers x[-20,20] y[90,110]
    expect(isWhite(at(0, 85))).toBe(true); // a +90deg rotation would cover y[80,120]
  });

  // ── offset reference box (Chromium oracle, measured with Blink 155/156) ──
  // Chromium resolves ray() origins and <basic-shape> geometry against the
  // containing block, even when the element sits inside a transformed ancestor.
  // The probes below pin that basis so a switch to the element's own border box
  // (or a double-applied ancestor transform) shows up as a moved box.

  it("offset-path: an explicit offset-position resolves against the containing block inside a transformed ancestor", async () => {
    // The element is at (30,20) inside a 200x150 containing block, so the two
    // candidate bases differ: containing block (100,50) vs element box (130,70).
    // Chromium uses (100,50); ray(90deg) + 40px puts the centre at (140,50) and
    // the ancestor's translate(50px,30px) moves the painted box to (180,70).
    // (The ancestor transform applies exactly once.)
    const { img } = await renderPng(
      `<div style="position:absolute;left:0;top:0;transform:translate(50px,30px);width:200px;height:150px;background:#eee">
         <div style="position:absolute;left:30px;top:20px;width:20px;height:20px;background:#f00;
           offset-path:ray(90deg);offset-position:100px 50px;offset-distance:40px"></div>
       </div>`,
    );
    expect(colorBox(img, isReddish)).toEqual({ x0: 180, y0: 70, x1: 199, y1: 89, n: 400 });
  });

  it("nested offset-path: an inner ray with offset-position:auto composes with the outer offset transform", async () => {
    // Chromium: the outer ray anchors its centre on (60,40), i.e. it shifts by
    // (0,-20), and offset-rotate:auto turns the whole subtree by 90deg. The
    // inner ray origin is its own border-box top-left (10,40); distance 30 puts
    // the inner centre at (40,40) in the containing block, which the outer
    // transform maps to (80,20) - an element-box basis would land elsewhere.
    const { img, at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:120px;height:120px;background:#eee;
         offset-path:ray(180deg);offset-position:60px 10px;offset-distance:30px">
         <div style="position:absolute;left:10px;top:40px;width:20px;height:20px;background:#f00;
           offset-path:ray(90deg);offset-position:auto;offset-distance:30px"></div>
       </div>`,
    );
    expect(colorBox(img, isReddish)).toEqual({ x0: 70, y0: 10, x1: 89, y1: 29, n: 400 });
    // The outer box really moved up by 20px (its 120px height now ends at y=99).
    expect(near(at(5, 95), [238, 238, 238])).toBe(true);
    expect(isWhite(at(5, 105))).toBe(true);
  });

  it("nested offset-path: an inner explicit offset-position uses the containing block percentages", async () => {
    // Chromium: 25% 50% of the 120x120 containing block is (30,60); ray(90deg)
    // + 20px puts the inner centre at (50,60), and the outer offset transform
    // (shift (0,-20) + 90deg rotation) maps it to (60,30).
    const { img, at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:120px;height:120px;background:#eee;
         offset-path:ray(180deg);offset-position:60px 10px;offset-distance:30px">
         <div style="position:absolute;left:10px;top:40px;width:20px;height:20px;background:#f00;
           offset-path:ray(90deg);offset-position:25% 50%;offset-distance:20px"></div>
       </div>`,
    );
    expect(colorBox(img, isReddish)).toEqual({ x0: 50, y0: 20, x1: 69, y1: 39, n: 400 });
    expect(near(at(5, 95), [238, 238, 238])).toBe(true);
    expect(isWhite(at(5, 105))).toBe(true);
  });

  it("offset-path: a basic-shape circle resolves against the containing block inside and outside a transformed ancestor", async () => {
    // Chromium: circle centre (10,40) + radius 20 -> path start (30,40), where
    // the box centre lands. An element-border-box basis would start at (70,80).
    const outside = await renderPng(
      `<div style="position:absolute;left:40px;top:40px;width:40px;height:40px;background:#f00;
         offset-path:circle(20px at 10px 40px);offset-distance:0"></div>`,
    );
    expect(colorBox(outside.img, isReddish)).toEqual({ x0: 10, y0: 20, x1: 49, y1: 59, n: 1600 });

    // Same shape inside a translated ancestor: the circle stays in the outer
    // containing block's coordinates (start (30,10)), then translate(50px,30px).
    const inside = await renderPng(
      `<div style="position:absolute;left:0;top:0;transform:translate(50px,30px);width:150px;height:120px;background:#eee">
         <div style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#f00;
           offset-path:circle(20px at 10px 10px);offset-distance:0"></div>
       </div>`,
    );
    expect(colorBox(inside.img, isReddish)).toEqual({ x0: 60, y0: 20, x1: 99, y1: 59, n: 1600 });
  });

  it("offset-path: a basic-shape inset(0) starts at the containing block's top-left edge", async () => {
    // Chromium: inset(0) uses the 150x120 containing block as reference rectangle
    // and starts at its top-left corner, so the element centre lands on (0,0) and
    // the ancestor transform leaves the 40x40 box at (30,10).
    const { img } = await renderPng(
      `<div style="position:absolute;left:0;top:0;transform:translate(50px,30px);width:150px;height:120px;background:#eee">
         <div style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#f00;
           offset-path:inset(0);offset-distance:0"></div>
       </div>`,
    );
    expect(colorBox(img, isReddish)).toEqual({ x0: 30, y0: 10, x1: 69, y1: 49, n: 1600 });
  });

  it("text-decoration-skip-ink: auto interrupts the underline at the descenders", async () => {
    const base = "text-decoration:underline;text-decoration-color:#f00";
    // `auto` is the initial value: the ink of the descenders is skipped.
    const auto_ = decorationLine(await renderProbeText(probeLine(base, "gjpq")));
    const none = decorationLine(
      await renderProbeText(probeLine(`${base};text-decoration-skip-ink:none`, "gjpq")),
    );
    expect(auto_.row).toBe(none.row);
    // g/j/p/q punch holes into the underline, so fewer pixels stay red.
    expect(auto_.count).toBeLessThan(none.count);
  });

  it("text-decoration-skip-ink: all also skips the ink above the baseline", async () => {
    // A negative text-underline-offset lifts the line above the baseline, where the
    // glyph bodies cross it. `auto` only skips the descender ink, `all` skips any ink.
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-underline-offset:-14px";
    const auto_ = decorationLine(await renderProbeText(probeLine(base, "Hxp")));
    const all = decorationLine(
      await renderProbeText(probeLine(`${base};text-decoration-skip-ink:all`, "Hxp")),
    );
    expect(auto_.row).toBe(all.row);
    expect(all.count).toBeLessThan(auto_.count);
  });

  it("text-underline-position: under draws the underline below the descenders", async () => {
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:none";
    const auto_ = decorationLine(await renderProbeText(probeLine(base, "Hxg")));
    const under = decorationLine(
      await renderProbeText(probeLine(`${base};text-underline-position:under`, "Hxg")),
    );
    expect(under.row).toBeGreaterThan(auto_.row);
  });

  it("text-underline-position: from-font uses the underline position of the font", async () => {
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:none";
    const auto_ = decorationLine(await renderProbeText(probeLine(base, "Hxg")));
    const fromFont = decorationLine(
      await renderProbeText(probeLine(`${base};text-underline-position:from-font`, "Hxg")),
    );
    expect(fromFont.row).not.toBe(auto_.row);
  });

  it("text-underline-position: left/right move the underline in vertical writing modes", async () => {
    const vertical = async (position: string) => {
      const body = `<div style="writing-mode:vertical-rl;height:200px;width:120px;font-family:'RobotoProbe',sans-serif;font-size:20px">
         <span style="text-decoration:underline;text-decoration-color:#f00;text-underline-position:${position}">ABC</span></div>`;
      const html = `<html><head><style>${PROBE_FONT_FACE}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
      const { data } = await render({ value: html, width: 200, format: "png" });
      return redColumns(PNG.sync.read(Buffer.from(data)));
    };
    const right = await vertical("right");
    const left = await vertical("left");
    expect(right.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    // vertical-rl: `right` hugs the right edge of the column, `left` the left one.
    expect(left[0]).toBeLessThan(right[0]);
  });

  it("text-decoration-skip-ink: all also skips the ink on the line-through", async () => {
    // The line-through crosses the x-height, so `all` has ink to skip there.
    const base =
      "text-decoration:line-through;text-decoration-color:#f00;text-decoration-skip-ink:none";
    const none = decorationLine(await renderProbeText(probeLine(base, "Hxg")));
    const all = decorationLine(
      await renderProbeText(probeLine(`${base};text-decoration-skip-ink:all`, "Hxg")),
    );
    expect(all.row).toBe(none.row);
    expect(all.count).toBeLessThan(none.count);
  });

  it("text-decoration-skip-ink: all also skips the ink on the overline", async () => {
    // The overline is painted at the top of the text box, i.e. above the
    // ascent, so its band only reaches the glyph ink when it is thick enough.
    const overline = (skip: string) =>
      `<div style="font-family:'RobotoProbe',sans-serif;font-size:30px;line-height:35px;padding-top:30px;color:#000;text-decoration:overline;text-decoration-color:#f00;text-decoration-thickness:20px;text-decoration-skip-ink:${skip}">Hxg</div>`;
    const none = decorationLine(await renderProbeText(overline("none")));
    const all = decorationLine(await renderProbeText(overline("all")));
    expect(all.row).toBe(none.row);
    expect(all.count).toBeLessThan(none.count);
  });

  it("text-decoration-thickness: from-font uses the underline thickness of the font", async () => {
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:none";
    const auto_ = await renderProbeText(probeLine(base, "Hxg"));
    const fromFont = await renderProbeText(
      probeLine(`${base};text-decoration-thickness:from-font`, "Hxg"),
    );
    // The font's own underline is thicker than the 1px `auto` default, so it
    // covers more pixels ...
    expect(redPixels(fromFont)).toBeGreaterThan(redPixels(auto_));
    // ... and it sits lower, because the underline hangs below the baseline by
    // its own thickness.
    expect(decorationLine(fromFont).row).toBeGreaterThan(decorationLine(auto_).row);
  });

  it("text-decoration-thickness: a percentage is relative to the font size", async () => {
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:none";
    // A percentage of text-decoration-thickness refers to the font size of
    // the element, so 50% of the 60px probe font is 30px.
    const percent = await renderProbeText(
      probeLine(`${base};text-decoration-thickness:50%`, "Hxg"),
    );
    const length = await renderProbeText(
      probeLine(`${base};text-decoration-thickness:30px`, "Hxg"),
    );
    expect(decorationLine(percent).row).toBe(decorationLine(length).row);
    expect(redPixels(percent)).toBe(redPixels(length));
  });

  it("text-decoration-skip-ink: the wavy underline skips the ink the wave crosses", async () => {
    // The wave oscillates around the underline position, so it reaches further
    // down than a solid line of the same thickness. The ink that crosses the
    // wave has to be skipped as well, not only the ink that crosses the
    // nominal band of the decoration.
    const base =
      "text-decoration:underline wavy;text-decoration-color:#f00;text-underline-offset:-2px";
    const none = await renderProbeText(
      probeLine(`${base};text-decoration-skip-ink:none`, "gjpq"),
    );
    const auto_ = await renderProbeText(
      probeLine(`${base};text-decoration-skip-ink:auto`, "gjpq"),
    );
    expect(redPixels(auto_)).toBeLessThan(redPixels(none));
  });

  it("text-decoration-skip-ink: the double decoration band covers both strokes", async () => {
    // The `double` style paints two strokes, one on either side of the nominal
    // decoration position. The skip band has to span both of them: an ink that
    // stops at the baseline crosses the stroke nearer to it, and must not be
    // painted over by that stroke.
    const base =
      "text-decoration:underline;text-decoration-style:double;text-decoration-color:#f00;text-decoration-thickness:4px";
    const none = await renderProbeText(
      probeLine(`${base};text-decoration-skip-ink:none`, "Hx"),
    );
    const all = await renderProbeText(
      probeLine(`${base};text-decoration-skip-ink:all`, "Hx"),
    );
    expect(redPixels(all)).toBeLessThan(redPixels(none));
  });

  it("text-decoration-skip-ink: the vertical underline skips the ink it crosses", async () => {
    // In a vertical writing mode the underline runs along the inline axis, so
    // the ink of the glyphs has to be rotated by 90 degrees to find the part
    // of the line the ink crosses.
    const vertical = async (skip: string) => {
      const body = `<div style="writing-mode:vertical-rl;height:200px;width:120px;font-family:'RobotoProbe',sans-serif;font-size:20px">
         <span style="text-decoration:underline;text-decoration-color:#f00;text-underline-offset:8px;text-decoration-skip-ink:${skip}">ABC</span></div>`;
      const html = `<html><head><style>${PROBE_FONT_FACE}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
      const { data } = await render({ value: html, width: 200, format: "png" });
      return PNG.sync.read(Buffer.from(data));
    };
    const none = await vertical("none");
    const auto_ = await vertical("auto");
    expect(redPixels(auto_)).toBeLessThan(redPixels(none));
  });

  it("text-decoration-skip-ink: the SVG output skips the ink as well", async () => {
    // The SVG renderer draws the glyphs as paths, so the decoration has to
    // gather the ink on that path as well.
    const underline = async (skip: string) => {
      const body = probeLine(
        `text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:${skip}`,
        "gjpq",
      );
      const html = `<html><head><style>${PROBE_FONT_FACE}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
      const { data } = await render({ value: html, width: 800, format: "svg" });
      // The decoration line is the only stroked path in the document (the
      // glyphs are filled paths in <defs>).
      return (data as string).match(/<path[^>]*stroke="[^"]*"[^>]*>/g) ?? [];
    };
    const none = await underline("none");
    const auto_ = await underline("auto");
    // Without the ink the underline is a single segment, with it the descenders
    // cut it into several pieces.
    expect(none.length).toBeGreaterThan(0);
    expect(auto_.length).toBeGreaterThan(none.length);
  });

  // CJK probe font: ::first-letter and text-emphasis need full-width glyphs to
  // have known character cells, so these probes load Noto Sans JP like the
  // vertical cases do.
  const CJK_PROBE_FONT_FACE =
    "@font-face{font-family:'NotoProbe';font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2) format('woff2')}";

  // In a 40px full-width line the character cells are 40px wide. Horizontal
  // text advances along x, vertical-rl text advances down y (one column here).
  const countRed = (img: PNG, x0: number, x1: number, y0: number, y1: number) => {
    let count = 0;
    for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++)
        if (isRedPixel(img, x, y)) count++;
    return count;
  };
  const redInHorizontalCell = (img: PNG, cell: number) =>
    countRed(img, cell * 40, (cell + 1) * 40, 0, img.height);
  // vertical-rl: the line advances down the page, one 40px row band per character.
  const redInVerticalCell = (img: PNG, cell: number) =>
    countRed(img, 0, img.width, cell * 40, (cell + 1) * 40);

  it("::first-letter includes the trailing closing punctuation (horizontal)", async () => {
    // CSS Selectors-4: the first letter unit plus any following punctuation
    // (Pe/Pf/Po) belongs to ::first-letter, so 「あ」 is wrapped as a whole.
    const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
      body{margin:0;background:#fff}
      p{margin:0;font-size:40px;line-height:1.4;color:#000;font-family:'NotoProbe',sans-serif}
      p::first-letter{color:#f00}</style></head><body><p>「あ」</p></body></html>`;
    const { data } = await render({ value: html, width: 300, format: "png" });
    const img = PNG.sync.read(Buffer.from(data));
    // Cell 0 is the opening bracket, cell 1 the letter, cell 2 the closing bracket.
    expect(redInHorizontalCell(img, 0)).toBeGreaterThan(5);
    expect(redInHorizontalCell(img, 1)).toBeGreaterThan(5);
    expect(redInHorizontalCell(img, 2)).toBeGreaterThan(5);
  });

  it("::first-letter includes the trailing closing punctuation (vertical)", async () => {
    const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
      body{margin:0;background:#fff}
      p{margin:0;font-size:40px;writing-mode:vertical-rl;height:200px;color:#000;font-family:'NotoProbe',sans-serif}
      p::first-letter{color:#f00}</style></head><body><p>「あ」</p></body></html>`;
    const { data } = await render({ value: html, width: 300, format: "png" });
    const img = PNG.sync.read(Buffer.from(data));
    // Vertical-rl advances down the page, so the character cells are 40px row
    // bands and the probe has a single column.
    expect(redInVerticalCell(img, 0)).toBeGreaterThan(5);
    expect(redInVerticalCell(img, 1)).toBeGreaterThan(5);
    expect(redInVerticalCell(img, 2)).toBeGreaterThan(5);
  });

  it("position:fixed/absolute fill the containing block with top+bottom/left+right and auto size", async () => {
    // CSS 2.1 10.6.4/10.3.7: when top+bottom (or left+right) are set and the
    // height/width is auto, the border box spans the containing block remainder.
    // A content-box element must subtract its own padding/border from that
    // remainder instead of adding it on top (which overflows by exactly that much).
    const GREEN: Rgb = [0, 255, 0];

    // viewport 300x200, fixed containing block = viewport.
    // Remainder: 300-20-40 = 240 wide, 200-20-40 = 140 tall.
    const fixed = await renderPng(
      `<div style="position:fixed;left:20px;right:40px;top:20px;bottom:40px;
         padding:10px;background:#00f"></div>`,
    );
    expect(near(fixed.at(25, 30), BLUE)).toBe(true);
    expect(near(fixed.at(255, 30), BLUE)).toBe(true);
    expect(isWhite(fixed.at(265, 30))).toBe(true); // would be blue if width grew by padding
    expect(near(fixed.at(25, 155), BLUE)).toBe(true);
    expect(isWhite(fixed.at(25, 165))).toBe(true); // would be blue if height grew by padding

    // absolute containing block = the 300x160 relative wrapper.
    // Remainder: 300-20-40 = 240 wide, 160-10-30 = 120 tall.
    const absolute = await renderPng(
      `<div style="position:relative;width:300px;height:160px">
         <div style="position:absolute;left:20px;right:40px;top:10px;bottom:30px;
           padding:10px;background:#0f0"></div>
       </div>`,
    );
    expect(near(absolute.at(255, 15), GREEN)).toBe(true);
    expect(isWhite(absolute.at(265, 15))).toBe(true);
    expect(near(absolute.at(25, 125), GREEN)).toBe(true);
    expect(isWhite(absolute.at(25, 145))).toBe(true);
  });

  // Total dark ink of an image: a mark per glyph can only add ink, so comparing
  // the counts detects whether the custom emphasis character is painted at all
  // (the probe font has no descenders to confound the count).
  const darkPixels = (img: PNG) => {
    let count = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i + 3] > 0 && img.data[i] < 128) count++;
      }
    return count;
  };

  it("text-emphasis: a custom string paints the character (horizontal)", async () => {
    // text-emphasis-style: <string> replaces the filled/open shapes with the
    // given character, drawn once per glyph. A ● is a much bigger mark than the
    // keyword dot, so the ink tells the two apart (and a missing mark paints
    // less ink than the dot).
    const renderCase = async (emphasis: string) => {
      const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
        body{margin:0;background:#fff}
        div{margin:0;font-size:40px;line-height:2;color:#000;font-family:'NotoProbe',sans-serif;${emphasis}}</style></head>
        <body><div>ああああ</div></body></html>`;
      const { data } = await render({ value: html, width: 400, format: "png" });
      return PNG.sync.read(Buffer.from(data));
    };
    const dot = await renderCase("text-emphasis:filled dot");
    const shorthand = await renderCase("text-emphasis:'●'");
    const longhand = await renderCase("text-emphasis-style:'●'");
    expect(darkPixels(shorthand)).toBeGreaterThan(darkPixels(dot) + 300);
    expect(darkPixels(longhand)).toBeGreaterThan(darkPixels(dot) + 300);
  });

  it("text-emphasis: a custom string paints the character (vertical)", async () => {
    const renderCase = async (emphasis: string) => {
      const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
        body{margin:0;background:#fff}
        div{margin:0;font-size:40px;line-height:2;color:#000;writing-mode:vertical-rl;height:200px;font-family:'NotoProbe',sans-serif;${emphasis}}</style></head>
        <body><div>ああああ</div></body></html>`;
      const { data } = await render({ value: html, width: 300, format: "png" });
      return PNG.sync.read(Buffer.from(data));
    };
    const dot = await renderCase("text-emphasis:filled dot");
    const shorthand = await renderCase("text-emphasis:'●'");
    const longhand = await renderCase("text-emphasis-style:'●'");
    expect(darkPixels(shorthand)).toBeGreaterThan(darkPixels(dot) + 300);
    expect(darkPixels(longhand)).toBeGreaterThan(darkPixels(dot) + 300);
  });
  it("a class + attribute compound selector checks the attribute", async () => {
    // `.n[data-open=true]` used to drop the [..] block while parsing the class name, so it
    // matched every .n element (MDN's closed navigation became position:fixed and collapsed).
    const { at } = await renderPng(
      `<style>.n[data-open=true]{background:#f00}.n{height:20px;background:#00f}</style>
       <div class="n" data-open="false"></div>`,
      100,
      30,
    );
    expect(near(at(50, 10), BLUE)).toBe(true);
    const on = await renderPng(
      `<style>.n[data-open=true]{background:#f00}.n{height:20px;background:#00f}</style>
       <div class="n" data-open="true"></div>`,
      100,
      30,
    );
    expect(near(on.at(50, 10), RED)).toBe(true);
  });

  it("calc() multiplies a length by a number on either side and over a parenthesised sum", async () => {
    // MDN gates its layout on calc(1rem * 2 + (15rem + 2rem) * 2 + 31rem) = 67rem (1072px), so
    // at 1000px the narrow-layout rules must apply. Heights keep the probe text-free.
    const { at } = await renderPng(
      `<style>
         .a{height:10px;width:calc(2 * 10px)}
         .b{height:10px;width:calc((10px + 20px) * 2)}
         .c{height:10px;width:calc(10px * 3 + 40px)}
       </style><div class="a" style="background:#00f"></div><div class="b" style="background:#00f"></div><div class="c" style="background:#00f"></div>`,
      200,
      40,
    );
    expect(near(at(15, 5), BLUE)).toBe(true); // 2 * 10px = 20px
    expect(isWhite(at(25, 5))).toBe(true);
    expect(near(at(55, 15), BLUE)).toBe(true); // (10 + 20) * 2 = 60px
    expect(isWhite(at(65, 15))).toBe(true);
    expect(near(at(65, 25), BLUE)).toBe(true); // 10 * 3 + 40 = 70px
    expect(isWhite(at(75, 25))).toBe(true);
  });

  it("grid minmax(<length>, <length>) tracks grow to their maximum before fr tracks", async () => {
    // MDN: [..] minmax(15rem,1fr) 2rem minmax(0,48rem) minmax(0,1fr). The content track is not
    // content-sized: it takes the free space up to 48rem, leaving the fr tracks at their minimum.
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:minmax(40px,1fr) 10px minmax(0,150px) minmax(0,1fr);width:200px;height:10px">
         <div style="background:#f00"></div><div></div><div style="background:#00f"><i style="display:block;width:5px"></i></div>
       </div>`,
      300,
      20,
    );
    expect(near(at(20, 5), RED)).toBe(true); // 40px track
    expect(near(at(60, 5), BLUE)).toBe(true); // 150px track starts at 50
    expect(near(at(195, 5), BLUE)).toBe(true);
    expect(isWhite(at(205, 5))).toBe(true); // 40 + 10 + 150 = 200
  });
  it("linked stylesheets cascade in document order, not fetch-completion order", async () => {
    // python.org links style.css (large, slow) before mq.css (small, fast). The small sheet
    // used to land first and then lose to the later arrival, so its min-width rules
    // (`float:right`) never won and the header collapsed into a column.
    const html = `<html><head><link rel="stylesheet" href="slow.css"><link rel="stylesheet" href="fast.css"></head>
      <body style="margin:0;background:#fff"><div class="b" style="height:20px"></div></body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/slow.css" || req.url === "/fast.css") {
        const slow = req.url === "/slow.css";
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/css" });
          res.end(slow ? ".b{background:#f00}" : ".b{background:#00f}");
        }, slow ? 300 : 0);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 40,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const i = (img.width * 10 + 10) * 4;
      // fast.css is later in the document, so its blue wins over slow.css's red.
      expect(near([img.data[i], img.data[i + 1], img.data[i + 2]], BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("a shrink-to-fit float keeps its inner float:right inside the narrow box", async () => {
    // python.org's .options-bar-container (float:right) holds a float:right bar. The outer box
    // shrinks to its content, but its children were left where the full-width pass put them
    // (at the container's far right edge), so the bar painted outside and vanished.
    const { at } = await renderPng(
      `<div style="width:300px"><div style="float:right"><div style="float:right;width:100px;height:10px;background:#00f"></div></div></div>`,
      300,
      20,
    );
    expect(near(at(250, 5), BLUE)).toBe(true); // x=200..299
    expect(isWhite(at(150, 5))).toBe(true);
  });

  it("a shrink-to-fit float is as wide as its inline content plus the float beside it", async () => {
    // Chromium's max-content for `Donate <float:right bar>` is the line plus the float. Taking
    // only the wider of the two made the box too narrow and the float wrapped below the text.
    const { at } = await renderPng(
      `<div style="width:300px"><div style="float:right">
         <span style="display:inline-block;width:40px;height:10px;background:#f00"></span>
         <div style="float:right;width:100px;height:10px;background:#00f"></div></div></div>`,
      300,
      40,
    );
    expect(near(at(165, 15), RED)).toBe(true); // inline part starts at 300 - 140 (sits on the baseline)
    expect(near(at(250, 5), BLUE)).toBe(true); // float beside it on the same row
    expect(isWhite(at(250, 25))).toBe(true); // nothing wrapped to a second row
  });
  it("floats whose percentage widths sum to exactly 100% stay on one row", async () => {
    // python.org's four .small-widget columns: 4 * 23.40426% + 3 * 2.12766% = 100%. Float
    // rounding made the last one overshoot the line by a hair and wrap below the others.
    const w = "float:left;height:10px;width:23.40426%;margin-right:2.12766%";
    const { at } = await renderPng(
      `<div style="width:948px"><div style="${w};background:#f00"></div><div style="${w};background:#0f0"></div>
         <div style="${w};background:#00f"></div><div style="${w};margin-right:0;background:#f0f"></div></div>`,
      1000,
      30,
    );
    expect(near(at(900, 5), [255, 0, 255])).toBe(true); // fourth column, first row
    expect(isWhite(at(900, 15))).toBe(true); // nothing wrapped to a second row
  });
  it("the media attribute of <style> and <link rel=stylesheet> limits where the sheet applies", async () => {
    // `element` keeps no attributes, so <style media> was dropped and print-only CSS applied on
    // screen; fetched <link media> sheets were concatenated without their media query.
    const paint = async (media: string) => {
      const { at } = await renderPng(
        `<style>div{height:20px;background:#f00}</style><style media="${media}">div{background:#00f}</style><div></div>`,
        100,
        30,
      );
      return near(at(50, 10), BLUE);
    };
    expect(await paint("screen")).toBe(true);
    expect(await paint("not print, braille")).toBe(true);
    expect(await paint("(min-width: 50px)")).toBe(true);
    expect(await paint("print")).toBe(false);
    expect(await paint("not screen")).toBe(false);
    expect(await paint("(min-width: 600px)")).toBe(false);

    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="stylesheet" href="base.css"><link rel="stylesheet" media="print" href="print.css">
          <link rel="stylesheet" media="screen" href="screen.css"></head>
          <body style="margin:0"><div class="a"></div><div class="b"></div></body></html>`);
      } else if (req.url === "/base.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("div{height:10px;background:#f00}");
      } else if (req.url === "/print.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".a{background:#0f0}");
      } else if (req.url === "/screen.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{background:#00f}");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(50, 5), RED)).toBe(true); // print.css must not turn .a green
      expect(near(at(50, 15), BLUE)).toBe(true); // screen.css applies to .b
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("a percentage flex-basis does not collapse an intrinsically sized flex container to min-content", async () => {
    // A flex item with a non-auto flex-basis had its available width zeroed even when it was
    // measured for its content size, so the wrapper reported its longest word as the width and a
    // column flex parent took the 10-line height (vuejs.org rendered 1.85x too tall).
    const txt = "Truly reactive, compiler-optimized rendering system that rarely requires manual optimization.";
    const heightOf = async (body: string) => {
      const r = await render({
        value: `<!DOCTYPE html><style>body{margin:0}.a{display:flex;flex-direction:column}.c{display:flex;flex-wrap:wrap}.b{flex:0 32%}p{margin:0}</style>${body}`,
        width: 1000,
        format: "png",
      });
      return r.height;
    };
    const col = await heightOf(`<div class="a"><div><section class="c"><div class="b"><p>${txt}</p></div></section></div></div>`);
    expect(col).toBeLessThan(110); // Chromium: 3 lines of 24px = 72 (+ rounding), was 240
    const shrink = await heightOf(`<div style="display:inline-block"><div class="c"><div class="b"><p>${txt}</p></div></div></div>`);
    expect(shrink).toBeLessThan(110); // Chromium: 4 lines = 96, was 231
  });
  it('<link rel="preload stylesheet"> loads the sheet; "alternate stylesheet" does not', async () => {
    // rel is a token list. Only the exact string "stylesheet" was recognised, so vuejs.org
    // (rel="preload stylesheet") rendered completely unstyled.
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="preload stylesheet" href="a.css" as="style">
          <link rel="alternate stylesheet" href="b.css"></head>
          <body style="margin:0"><div class="a"></div><div class="b"></div></body></html>`);
      } else if (req.url === "/a.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("div{height:10px;background:#f00}.a{background:#00f}");
      } else if (req.url === "/b.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{background:#0f0}");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(50, 5), BLUE)).toBe(true); // a.css applied
      expect(near(at(50, 15), RED)).toBe(true); // b.css (alternate) ignored
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("position:relative offsets an inline box once, background and text together", async () => {
    // The offset was applied again each time the line box was finished (text drifted 6x the
    // requested distance and left the page) and never reached the inline box's background.
    const redBox = async (offset: string) => {
      const { img } = await renderPng(
        `<div style="font:14px/20px sans-serif"><a style="background:#f00;position:relative;${offset}">Donate Donate</a></div>`,
        300,
        100,
      );
      let minX = 999, maxX = -1, minY = 999, maxY = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 0) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      return { minX, maxX, minY, maxY };
    };
    const base = await redBox("top:0");
    const down = await redBox("top:19px");
    const right = await redBox("left:50px");
    const bottom = await redBox("bottom:-7px");
    expect(down.minY - base.minY).toBe(19);
    expect(down.maxY - base.maxY).toBe(19);
    expect(right.minX - base.minX).toBe(50);
    expect(right.maxX - right.minX).toBe(base.maxX - base.minX); // same width, just moved
    expect(bottom.minY - base.minY).toBe(7);
  });
  it("relative url() in a linked stylesheet resolves against the stylesheet, not the page", async () => {
    // python.org links /static/stylesheets/style.css, whose fonts and images are
    // `url(../fonts/..)`. They were resolved against the page (`/fonts/..`), failed, and the
    // text fell back to a wider font that pushed the header out of shape.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0000ff"/></svg>`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="stylesheet" href="static/css/site.css"></head>
          <body style="margin:0"><div class="b"></div></body></html>`);
      } else if (req.url === "/static/css/site.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{width:20px;height:20px;background:url(../img/p.svg)}");
      } else if (req.url === "/static/img/p.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(svg);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 60,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const i = (img.width * 10 + 10) * 4;
      expect(near([img.data[i], img.data[i + 1], img.data[i + 2]], BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("an absolutely positioned box between inline items does not break the line", async () => {
    // python.org's search form holds a visually hidden `position:absolute` <label> between
    // inline-blocks. It was treated as a block-level child and split the line in three.
    const html = (mid: string) =>
      `<div style="font:14px/20px sans-serif;display:inline-block;background:#eee">
         <span style="display:inline-block;width:30px;height:20px;background:#f00"></span>${mid}
         <span style="display:inline-block;width:100px;height:20px;background:#00f"></span></div>`;
    const plain = await renderPng(html(""), 300, 100);
    const withAbs = await renderPng(
      html(`<label style="position:absolute;width:1px;height:1px;overflow:hidden">Search</label>`),
      300,
      100,
    );
    const rows = (img: PNG) => {
      let last = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 255) last = y;
        }
      }
      return last;
    };
    expect(rows(withAbs.img)).toBe(rows(plain.img)); // the blue box stays on the first line
  });
  it("stylesheet fill/stroke (classes, var(), light-dark()) paint inline SVG shapes", async () => {
    // The inline SVG was rebuilt from its attributes alone, so `.logo__letter{fill:...}` (MDN's
    // logo, every CSS-coloured icon) never applied and the shapes came out black.
    const cases: [string, string][] = [
      ["class", ".r{fill:#00f}"],
      ["descendant", "svg rect{fill:#00f}"],
      ["var", ":root{--c:#00f}.r{fill:var(--c)}"],
      ["var fallback", ".r{fill:var(--missing,#00f)}"],
      ["nested var", ":root{--a:#00f;--b:var(--a)}.r{fill:var(--b)}"],
      ["light-dark", ".r{fill:light-dark(#00f,#f00)}"],
      ["overrides attribute", ".r{fill:#00f}"],
    ];
    for (const [name, css] of cases) {
      const attr = name === "overrides attribute" ? ' fill="#f00"' : "";
      const { at } = await renderPng(
        `<style>${css}</style><svg width="20" height="20"><rect class="r" width="20" height="20"${attr}/></svg>`,
        40,
        30,
      );
      expect(near(at(10, 10), BLUE), name).toBe(true);
    }
    // An undefined variable without a fallback drops the declaration: the attribute survives.
    const { at } = await renderPng(
      `<style>.r{fill:var(--nope)}</style><svg width="20" height="20"><rect class="r" width="20" height="20" fill="#0000ff"/></svg>`,
      40,
      30,
    );
    expect(near(at(10, 10), BLUE)).toBe(true);
  });

  it("mask-image url() images are fetched before the final paint", async () => {
    // The mask image was only requested when the mask was painted, after the resource rounds,
    // so an http-hosted mask never loaded and hid its whole box (MDN's icon buttons).
    const circle = new PNG({ width: 24, height: 24 });
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const i = (y * 24 + x) * 4;
        circle.data[i + 3] = (x - 11.5) ** 2 + (y - 11.5) ** 2 < 100 ? 255 : 0;
      }
    }
    const png = PNG.sync.write(circle);
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body style="margin:0"><div style="width:24px;height:24px;background:#00f;mask-image:url(/c.png);mask-size:cover"></div></body></html>`);
      } else if (req.url === "/c.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 40,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const px = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(px(12, 12), BLUE)).toBe(true); // inside the circle
      expect(img.data[(1 * img.width + 1) * 4 + 3]).toBe(0); // corner masked out
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("an absolute box with an auto height keeps its calc()/percentage width", async () => {
    // MDN's visually hidden skip links: `ul{position:absolute;width:calc(100% - 4px)}` holding
    // `a{position:absolute;left:0;right:0}`. The auto height made the box measure as shrink-to-fit,
    // which turned the calc() width into auto: the ul collapsed to its padding and the links
    // wrapped one letter per line, with the tail of the column showing at the top-left.
    const { at } = await renderPng(
      `<style>*{box-sizing:border-box}</style>
       <ul style="margin:0;list-style:none;position:absolute;top:0;left:2px;right:2px;padding-left:40px;width:calc(100% - 4px)">
         <li><a style="position:absolute;left:0;right:0;top:0;height:10px;background:#f00"></a></li></ul>`,
      300,
      30,
    );
    expect(near(at(20, 5), RED)).toBe(true); // inside the padding box
    expect(near(at(250, 5), RED)).toBe(true); // ... and far past the 40px padding
    expect(isWhite(at(299, 5))).toBe(true); // 2 + 296 = the box ends at 298
  });
  it("deeply nested flex containers do not re-measure their subtree exponentially", async () => {
    // Every flex container asks each item for its min-content and max-content size before the real
    // measure, and each of those recursed into the whole subtree: ~4^depth measures. nodejs.org's
    // hero (flex > flex-col > flex > inline-flex > inline-flex buttons) spent 10s and exhausted the
    // measure budget. Intrinsic-size queries are now memoized per pass (~3s -> ~0.3s here).
    const btn = `<a style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px"><svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#f00"/></svg></a>`;
    let html =
      `<div style="display:flex;justify-content:center">` +
      Array.from({ length: 3 }, () => `<div style="display:inline-flex;gap:4px">${btn}${btn}${btn}${btn}</div>`).join("") +
      `</div>`;
    for (let i = 0; i < 5; i++) {
      html = `<div style="display:flex;flex-direction:${i % 2 ? "row" : "column"};gap:4px"><div style="display:flex">x</div>${html}</div>`;
    }
    await renderPng("<p>warm up</p>", 100, 20);
    const t = Date.now();
    await renderPng(html, 600, 300);
    expect(Date.now() - t).toBeLessThan(1800);
  });
  it("a counter() reads once per element, even when styles are refreshed for a second layout pass", async () => {
    // nodejs.org numbers its code lines with `.line:after{counter-increment:line;content:counter(line)}`.
    // The increment ran once per matching rule and again on the second (table / container query)
    // style refresh, so the first line read 15 instead of 1.
    const lines = Array.from({ length: 9 }, () => `<div class="l"></div>`).join("");
    const { at } = await renderPng(
      `<style>.c{counter-reset:n;font:12px monospace}.l{height:14px;color:#000}
       .l:after{counter-increment:n;content:counter(n)}.l:after{color:#000}</style>
       <table><tr><td></td></tr></table><div class="c">${lines}</div>`,
      120,
      160,
    );
    // The ninth line is a single digit: nothing is drawn right of x=9 on its row.
    let ink = 0;
    for (let y = 0; y < 160; y++) for (let x = 12; x < 40; x++) if (!isWhite(at(x, y))) ink++;
    expect(ink).toBe(0);
  });
  it("white-space-only text between grid items makes no grid row, even with white-space:pre", async () => {
    // Shiki code blocks: `code{display:grid}` holding `<span class=line>` elements separated by
    // newline text. Under `pre` that text was an anonymous grid item that doubled every row.
    const grid = (sep: string) =>
      `<body style="margin:0"><div style="display:grid;white-space:pre;font:10px/10px sans-serif"><div>a</div>${sep}<div>b</div>${sep}<div>c</div></div></body>`;
    const withText = await render({ value: grid("\n"), width: 100, format: "png" });
    const without = await render({ value: grid(""), width: 100, format: "png" });
    expect(withText.height).toBe(without.height);
  });
  it("grid items with a definite width or height are not stretched to their area", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px"><div style="width:60px;height:10px;background:#f00"></div><div style="height:10px;background:#00f"></div></div>
       <div style="display:grid;grid-template-columns:100px"><div style="width:50%;height:10px;background:#f00"></div></div>`,
      220,
      40,
    );
    expect(near(at(55, 5), RED)).toBe(true); // 60px wide
    expect(isWhite(at(65, 5))).toBe(true); // ... not the 100px column
    expect(near(at(150, 5), [0, 0, 255])).toBe(true); // an auto-width sibling still stretches
    expect(near(at(45, 15), RED)).toBe(true); // 50% of the 100px area
    expect(isWhite(at(55, 15))).toBe(true);
  });
  it("a grid item with a definite height reserves no extra line", async () => {
    const r = await render({
      value: `<body style="margin:0;font:16px sans-serif"><div style="display:grid"><div style="height:10px"></div><div style="height:10px"></div></div></body>`,
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(20);
  });
  it("default-sized monospace text is 13px like Chromium, unless a size was set explicitly", async () => {
    // Chromium's fixed-font quirk: `font-family: monospace` alone at the default size is 13px.
    // `<code>` also had no monospace rule at all. An ancestor's explicit px size opts out.
    const inkWidth = async (body: string) => {
      const { img } = await renderPng(body, 300, 40);
      let lo = 1e9;
      let hi = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i] < 128) {
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
      return hi - lo;
    };
    const text = "mmmmmmmmmm";
    const plain = await inkWidth(`<code>${text}</code>`);
    const pre = await inkWidth(`<pre style="margin:0">${text}</pre>`);
    const sized = await inkWidth(`<div style="font-size:16px"><pre style="margin:0">${text}</pre></div>`);
    expect(Math.abs(plain - pre)).toBeLessThanOrEqual(1); // <code> is monospace as well
    expect(sized / plain).toBeGreaterThan(1.15); // 16px vs 13px
    expect(sized / plain).toBeLessThan(1.3);
  });
  it("a text input's height follows its padding and line-height instead of a fixed 21px", async () => {
    // python.org's search field: `padding:6.4px 8px 4.8px; line-height:26px` is 37px tall in Chromium;
    // the UA rule's fixed `height:21px` ignored both.
    const h = async (style: string) =>
      (await render({
        value: `<html><body style="margin:0"><input style="display:block;border:0;box-sizing:border-box;${style}"></body></html>`,
        width: 200,
        format: "png",
      })).height;
    expect(await h("padding:6px 8px 5px;line-height:26px;font-size:16px")).toBe(37);
    expect(await h("line-height:40px;font-size:16px;padding:0")).toBe(40);
  });
  it("an inline box's background stops at its border edge, not at its margins", async () => {
    // python.org's Donate button: `a{margin-right:8px;padding:0 12px;background:...}` was painted
    // 8px too wide because the margin was part of the inline fragment box.
    const { at } = await renderPng(
      `<div style="font:16px/20px monospace;padding-top:10px"><span style="margin:0 10px;padding:0 5px;background:#f00;color:#f00">xx</span></div>`,
      120,
      40,
    );
    expect(isWhite(at(4, 20))).toBe(true); // left margin
    expect(near(at(13, 20), RED)).toBe(true); // padding starts at 10px
    expect(near(at(10 + 5 + 16 + 5 - 3, 20), RED)).toBe(true);
    expect(isWhite(at(10 + 5 + 16 + 5 + 6, 20))).toBe(true); // right margin (box ends at ~36px)
  });
  it("grid items honor justify-items / align-items / justify-self / align-self", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:100px;justify-items:center"><div style="height:10px;width:40px;background:#f00"></div></div>
       <div style="display:grid;grid-template-columns:100px;height:50px"><div style="height:10px;width:40px;background:#f00;align-self:end;justify-self:end"></div></div>`,
      200,
      70,
    );
    expect(near(at(35, 5), RED)).toBe(true); // centered in the 100px column: 30..70
    expect(isWhite(at(25, 5))).toBe(true);
    expect(isWhite(at(75, 5))).toBe(true);
    expect(near(at(80, 55), RED)).toBe(true); // end/end of the 100x50 area: x 60..100, y 50..60
    expect(isWhite(at(50, 55))).toBe(true);
  });
  it("an svg with width/height=\"100%\" sizes from its viewBox, also as a flex-column item", async () => {
    // react.dev's hero logo: `<svg width="100%" height="100%" viewBox=...>` (width set by a class) in a
    // flex column. "100%" was read as 100px by atof() and the percentage height resolved against
    // the viewport: the page grew to 600M px and the render failed.
    const page = (inner: string) =>
      `<!DOCTYPE html><html><body style="margin:0">${inner}</body></html>`;
    const svg = `<svg width="100%" height="100%" viewBox="0 0 21 18.9" style="width:84px"><rect width="21" height="18.9" fill="#f00"/></svg>`;
    const block = await render({ value: page(`<div>${svg}</div>`), width: 200, format: "png" });
    const flex = await render({ value: page(`<div style="display:flex;flex-direction:column">${svg}</div>`), width: 200, format: "png" });
    expect(Math.abs(block.height - 75.6)).toBeLessThan(1); // 84 * 18.9 / 21
    expect(Math.abs(flex.height - 75.6)).toBeLessThan(1);
  });
  it("equal-specificity rules apply in source order, not in the order of the element's classes", async () => {
    // react.dev: `.flex{display:flex}` ... `.uwu-visible{display:none}` on class="uwu-visible flex":
    // the class buckets were applied in attribute order, so `.flex` (listed second) won.
    const { at } = await renderPng(
      `<style>.flex{display:flex}.hide{display:none}.a{color:#f00}.b{color:#00f}</style>
       <div class="hide flex" style="height:20px;background:#f00"></div>
       <div class="b a" style="height:20px;background:currentColor"></div>`,
      60,
      40,
    );
    expect(near(at(30, 5), [0, 0, 255])).toBe(true); // .b is later than .a: blue, although `a` is listed last
    expect(isWhite(at(30, 25))).toBe(true); // the .hide.flex box is display:none, so nothing else is drawn
  });
  it("an inset box-shadow with a spread draws an inner ring (tailwind's shadow-*-stroke borders)", async () => {
    const { at } = await renderPng(
      `<div style="width:60px;height:30px;background:#fff;--s:inset 0 0 0 3px #f00;box-shadow:var(--a,0 0 #0000),var(--s)"></div>`,
      80,
      40,
    );
    expect(near(at(0, 15), RED)).toBe(true);
    expect(near(at(2, 15), RED)).toBe(true);
    expect(isWhite(at(4, 15))).toBe(true);
    expect(near(at(30, 1), RED)).toBe(true);
    expect(isWhite(at(30, 15))).toBe(true);
  });
  it("a percentage flex-basis (flex: 1 1) in an auto-height column sizes to content", async () => {
    // react.dev's sandpack code blocks: `.sp-stack{display:flex;flex-direction:column}` holding
    // `.sp-code-editor{flex:1 1;overflow:auto}`. The basis is 0% of an indefinite height, i.e. content;
    // the editor collapsed to nothing.
    const h = async (item: string) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0"><div style="display:flex;flex-direction:column"><div style="${item}"><div style="height:50px">a</div></div></div></body></html>`,
        width: 200,
        format: "png",
      })).height;
    expect(await h("flex:1 1;overflow:auto")).toBe(50);
    expect(await h("flex-basis:0%;overflow:auto")).toBe(50);
    // ... also when an align-items:center row measures it first (column items had no content basis in measure mode)
    const centered = await render({
      value: `<!DOCTYPE html><html><body style="margin:0"><div style="display:flex;align-items:center"><div style="display:flex;flex-direction:column"><div style="flex:1 1;overflow:auto"><div style="height:50px">a</div></div></div></div></body></html>`,
      width: 200,
      format: "png",
    });
    expect(centered.height).toBe(50);
  });
  it("@supports follows Chromium: no margin-trim / -webkit-hyphens / -moz-*, but relative color syntax", async () => {
    // Tailwind v4's `@layer properties` sits behind a Safari/Firefox-only @supports hack; applying it
    // reset every --tw-* custom property to `initial` and inflated the layout.
    const h = async (cond: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>body{margin:0}@supports ${cond}{div{height:50px}}</style></head><body><div></div></body></html>`,
        width: 100,
        format: "png",
      })).height;
    const hit = await h("(display:block)");
    expect(hit).toBeGreaterThanOrEqual(50);
    for (const cond of ["(margin-trim:inline)", "(-webkit-hyphens:none)", "(-moz-orient:inline)"]) {
      expect(await h(cond)).toBeLessThan(50);
    }
    expect(await h("(color:rgb(from red r g b))")).toBeGreaterThanOrEqual(50);
    expect(await h("(not (margin-trim:inline))")).toBeGreaterThanOrEqual(50);
  });
  it("a transparent or fully hidden box-shadow does not grow the page", async () => {
    // Tailwind's `box-shadow: 0 0 #0000, ...` defaults added 10px of "shadow room" per element.
    const h = async (shadow: string) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0"><div style="height:30px;box-shadow:${shadow}"></div></body></html>`,
        width: 100,
        format: "png",
      })).height;
    const plain = await h("none");
    expect(await h("0 0 #0000, inset 0 0 0 1px #888")).toBe(plain);
    expect(await h("0 0 0 0 #f00")).toBe(plain);
    expect(await h("0 4px 12px #f00")).toBeGreaterThan(plain); // a visible shadow still keeps its room
  });
  it("@container queries see a flex or grid container's size", async () => {
    // tailwind's `@container flex flex-col` cards: the query reads the container's render item, and
    // flex/grid items never registered themselves, so the container looked 0px wide (query never matched).
    const h = async (container: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>*{box-sizing:border-box}.c{container-type:inline-size}
          .row{display:flex;flex-direction:column;gap:24px;padding:24px}
          @container (min-width:28rem){.row{flex-direction:row}}
          .i{height:50px;width:100px}.t{height:30px}</style></head>
          <body style="margin:0;width:600px"><div class="c" style="${container}"><div class="row"><div class="i"></div><div class="t"></div></div></div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    expect(await h("")).toBe(98); // row layout: 50 + 2 * 24
    expect(await h("display:flex;flex-direction:column")).toBe(98);
    expect(await h("display:grid")).toBe(98);
  });
  it("grid: negative line numbers count from the end, and a lone `dense` means `row dense`", async () => {
    // tailwind's `col-span-full` is `grid-column: 1 / -1` and `grid-flow-dense` is `grid-auto-flow: dense`.
    const h = async (flow: string, spec: string[]) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0;width:600px"><div style="display:grid;grid-template-columns:repeat(30,minmax(0,1fr));${flow}gap:8px">${spec
          .map((s) => `<div style="grid-column:${s};height:20px"></div>`)
          .join("")}</div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    // full row after a 12-wide item: the full item needs a row of its own (2 rows: 20 + 8 + 20)
    expect(await h("", ["span 12 / span 12", "1 / -1"])).toBe(48);
    // dense: the 18-wide item backfills the first row next to the 12-wide one (3 rows -> 2)
    expect(await h("grid-auto-flow:dense;", ["span 12 / span 12", "1 / -1", "span 18 / span 18"])).toBe(48);
    expect(await h("", ["span 12 / span 12", "1 / -1", "span 18 / span 18"])).toBe(76);
  });
});
