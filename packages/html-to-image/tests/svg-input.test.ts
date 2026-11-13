import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";
import { svgHasText, svgIntrinsicSize, svgPage } from "../src/svg-input.js";

describe("svg input helpers", () => {
  it("finds text elements", () => {
    expect(svgHasText('<svg><text x="1">a</text></svg>')).toBe(true);
    expect(svgHasText("<svg><textPath>a</textPath></svg>")).toBe(false);
    expect(svgHasText("<svg><rect/></svg>")).toBe(false);
  });

  it("takes the size from width and height, else the viewBox, else 300x150", () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60px"/>')).toEqual({ width: 300, height: 60 });
    expect(svgIntrinsicSize('<svg viewBox="0 0 200 100"/>')).toEqual({ width: 200, height: 100 });
    expect(svgIntrinsicSize('<svg viewBox="0 0 200 100" width="400"/>')).toEqual({ width: 400, height: 200 });
    expect(svgIntrinsicSize('<svg width="50%"/>')).toEqual({ width: 300, height: 150 });
  });

  it("shows the svg edge to edge at its size", () => {
    const html = svgPage(new TextEncoder().encode("<svg/>"), { width: 30, height: 20 });
    expect(html).toContain("data:image/svg+xml;base64,PHN2Zy8+");
    expect(html).toContain("width:30px;height:20px");
  });
});

describe("SVG2 CSS geometry properties (WASM)", () => {
  it("applies CSS cx, cy, r, rx, ry, x, y, width, height over presentation attributes", async () => {
    const html = `
      <style>
        :root { --radius: 25px; }
        circle { cx: 50px; cy: calc(20px + 30px); r: var(--radius); fill: #ff0000; }
        ellipse { cx: 120px; cy: 60px; rx: 30px; ry: 15px; fill: #00aa00; }
        rect { x: 10px; y: 20px; width: 80px; height: 40px; rx: 8px; ry: 6px; fill: #0000ff; }
      </style>
      <svg width="200" height="120" xmlns="http://www.w3.org/2000/svg">
        <circle cx="1" cy="1" r="1" />
        <ellipse cx="1" cy="1" rx="1" ry="1" />
        <rect x="0" y="0" width="5" height="5" />
      </svg>
    `;

    const svgRes = await render({
      value: html,
      width: 200,
      height: 120,
      format: "svg",
    });
    const svgText = String(svgRes.data);
    expect(svgText).toContain('cx="50px"');
    expect(svgText).toContain('cy="50px"');
    expect(svgText).toContain('r="25px"');
    expect(svgText).toContain('cx="120px"');
    expect(svgText).toContain('ry="15px"');
    expect(svgText).toContain('x="10px"');
    expect(svgText).toContain('y="20px"');
    expect(svgText).toContain('width="80px"');
    expect(svgText).toContain('height="40px"');
    expect(svgText).toContain('rx="8px"');
    expect(svgText).toContain('ry="6px"');

    const pngRes = await render({
      value: html,
      width: 200,
      height: 120,
      format: "png",
    });
    expect(pngRes.data).toBeInstanceOf(Uint8Array);
    expect((pngRes.data as Uint8Array).length).toBeGreaterThan(100);
  });

  it("disables rendering for a zero viewBox while ignoring negative viewBox", async () => {
    const zeroVb = await render({
      value: '<div><svg width="100" height="100" viewBox="0 0 0 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff0000"/></svg></div>',
      width: 100,
      height: 100,
      format: "svg",
    });
    expect(String(zeroVb.data)).not.toContain("<rect");

    const negVb = await render({
      value: '<div><svg width="100" height="100" viewBox="0 0 -10 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff0000"/></svg></div>',
      width: 100,
      height: 100,
      format: "svg",
    });
    expect(String(negVb.data)).toContain("<rect");
  });
});
