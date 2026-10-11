import { describe, expect, it } from "vitest";
import { pdfFirstPageSize, svgRootHeight } from "../src/output-size.js";
import { render } from "../src/single.js";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("svgRootHeight", () => {
  it("reads the root height, not an inner element's", () => {
    const svg = `<svg xmlns="x" width="400" height="981.4"><rect width="1" height="5"/></svg>`;
    expect(svgRootHeight(svg)).toBe(981);
  });

  it("does not mistake stroke-height-like attributes or return inner height", () => {
    const svg = `<svg xmlns="x" viewBox="0 0 1 1"><rect height="7"/></svg>`;
    expect(svgRootHeight(svg)).toBeUndefined();
  });
});

describe("pdfFirstPageSize", () => {
  it("returns the first page's MediaBox size", () => {
    const pdf = bytes(
      "<</Type /Page /MediaBox [0 0 400 981]>> <</MediaBox [0 0 400 700]>>",
    );
    expect(pdfFirstPageSize(pdf)).toEqual({ width: 400, height: 981 });
  });

  it("handles a non-zero origin and fractional values", () => {
    expect(
      pdfFirstPageSize(bytes("/MediaBox [10 20 410.4 320.6]")),
    ).toEqual({ width: 400, height: 301 });
  });

  it("returns undefined without a usable box", () => {
    expect(pdfFirstPageSize(bytes("%PDF-1.4 nothing"))).toBeUndefined();
    expect(pdfFirstPageSize(bytes("/MediaBox [0 0 0 0]"))).toBeUndefined();
  });
});

describe("render: auto height is reported for pdf and svg (real wasm)", () => {
  const html = "<h1>a</h1><div style='height:900px'>tall</div>";
  it("pdf", async () => {
    const r = await render({ value: html, width: 400, format: "pdf", fontMap: {} });
    expect(r.height).toBeGreaterThan(900);
  });
  it("svg", async () => {
    const r = await render({ value: html, width: 400, format: "svg", fontMap: {} });
    expect(r.height).toBeGreaterThan(900);
  });
  it("an explicit height wins", async () => {
    const r = await render({ value: html, width: 400, height: 300, format: "pdf", fontMap: {} });
    expect(r.height).toBe(300);
  });
});
