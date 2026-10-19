import { describe, expect, it } from "vitest";
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

async function renderProbeText(body: string, width = 800) {
  const html = `<html><head><style>${PROBE_FONT_FACE}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
  const { data } = await render({ value: html, width, format: "png" });
  return PNG.sync.read(Buffer.from(data));
}

const probeLine = (style: string, text: string) =>
  `<div style="font-family:'RobotoProbe',sans-serif;font-size:60px;line-height:90px;color:#000;${style}">${text}</div>`;

// One 32-bit hash per ANMF (animation frame) chunk in a RIFF/WEBP container.
// Distinct hashes prove the sampled frames actually differ in pixel content.
function webpFrameHashes(data: Uint8Array): number[] {
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
  const hashes: number[] = [];
  let o = 12;
  while (o + 8 <= data.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (fourcc(o) === "ANMF") {
      let hash = 0;
      for (let i = o + 8; i < o + 8 + size && i < data.byteLength; i++) {
        hash = (hash * 31 + data[i]) >>> 0;
      }
      hashes.push(hash);
    }
    o += 8 + size + (size & 1);
  }
  return hashes;
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
    for (const tpl of ["auto 1fr", "max-content 1fr", "fit-content(200px) 1fr", "minmax(0, 200px) 1fr"]) {
      const r = await widths(tpl);
      expect(r.redEnd, tpl).toBe(60);
      expect(r.blueAtRedEnd, tpl).toBe(true);
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
});
