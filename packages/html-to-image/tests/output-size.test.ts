import { describe, expect, it } from "vitest";
import { pdfFirstPageSize, svgRootHeight } from "../src/output-size.js";
import { render } from "../src/single.js";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("svgRootHeight", () => {
  it("reads the root height, not an inner element's", () => {
    const svg = `<svg xmlns="x" width="400" height="981.4"><rect width="1" height="5"/></svg>`;
    expect(svgRootHeight(svg)).toBe(981);
  });
});

describe("pdfFirstPageSize", () => {
  it("returns the first page's MediaBox size", () => {
    const pdf = bytes(
      "<</Type /Page /MediaBox [0 0 400 981]>> <</MediaBox [0 0 400 700]>>",
    );
    expect(pdfFirstPageSize(pdf)).toEqual({ width: 400, height: 981 });
  });
});

describe("render: auto height is reported for pdf (real wasm)", () => {
  const html = "<h1>a</h1><div style='height:900px'>tall</div>";
  it("pdf", async () => {
    const r = await render({ value: html, width: 400, format: "pdf", fontMap: {} });
    expect(r.height).toBeGreaterThan(900);
  });
});
