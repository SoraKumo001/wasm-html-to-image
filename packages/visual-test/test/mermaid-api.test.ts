import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { renderMermaid } from "wasm-html-to-image/single";

const GRAPH = "graph LR\n  A[開始] --> B{判定}\n  B -->|はい| C[完了]";

describe("renderMermaid", () => {
  it("returns SVG text, sized to the diagram, with the drawing as vector shapes", async () => {
    const { data } = await renderMermaid(GRAPH);
    expect(typeof data).toBe("string");
    expect(data).toContain("<svg");
    expect(data).toContain("<polygon"); // the diamond and the arrow heads
    expect(data).toContain("開始");
    const outer = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(data)!;
    expect(Number(outer[1])).toBeLessThan(700); // not the 4096 px probe width
    expect(Number(outer[2])).toBeGreaterThan(40);
  });

  it("returns a PNG that is the size of the diagram, light and dark", async () => {
    const light = await renderMermaid(GRAPH, { format: "png" });
    const dark = await renderMermaid(GRAPH, { format: "png", theme: "dark" });
    const a = PNG.sync.read(Buffer.from(light.data));
    const b = PNG.sync.read(Buffer.from(dark.data));
    expect(a.width).toBeLessThan(700);
    expect(a.width).toBe(b.width);
    // the page takes the theme's background: white vs near black in the corner
    expect(a.data[0]).toBeGreaterThan(240);
    expect(b.data[0]).toBeLessThan(40);
  });

  it("honours width, padding and an explicit background", async () => {
    const { data } = await renderMermaid("graph TD\n  A --> B", { format: "png", width: 300, padding: 0, background: "#ff0000" });
    const png = PNG.sync.read(Buffer.from(data));
    expect(png.width).toBe(300);
    expect([png.data[0], png.data[1], png.data[2]]).toEqual([255, 0, 0]);
  });

  it("escapes the source and shows a bad diagram as an error box", async () => {
    const { data } = await renderMermaid("graph LR\n  A[\"a < b & c\"] --> B");
    expect(data).toContain("a &lt; b &amp; c");
    const bad = await renderMermaid("gantt\n  title x", { format: "png" });
    const png = PNG.sync.read(Buffer.from(bad.data));
    let red = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 180 && png.data[i + 1] < 80 && png.data[i + 2] < 80) red++;
    expect(red).toBeGreaterThan(20);
  });
});
