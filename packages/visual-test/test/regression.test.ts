import { describe, expect, it } from "vitest";
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
});
