import { describe, expect, it } from "vitest";
import { markdownToDocument } from "wasm-html-to-image/markdown";
import { DEFAULT_PANEL, panelFromParams, panelToParams, toMarkdownOptions, type MarkdownPanel } from "./markdownSettings";

const panel = (over: Partial<MarkdownPanel> = {}): MarkdownPanel => ({ ...DEFAULT_PANEL, ...over });

describe("panel -> markdownToDocument options", () => {
  it("leaves to the document and the template everything the panel does not set", () => {
    const o = toMarkdownOptions(panel());
    expect(o.template).toBeUndefined();
    expect(o.settings).toBeUndefined();
    expect(o.toc).toBeUndefined();
    expect(o).toMatchObject({ paged: true, theme: "light", highlight: true });
  });

  it("passes only the fields that were set", () => {
    const o = toMarkdownOptions(panel({ template: "book", pageSize: "A5", accent: "#112233", font: "serif", stamp: "DRAFT", cover: "on" }));
    expect(o.template).toBe("book");
    expect(o.settings).toEqual({ page_size: "A5", accent: "#112233", font: "serif", stamp: "DRAFT", cover: true });
    expect(toMarkdownOptions(panel({ cover: "off" })).settings).toEqual({ cover: false });
  });

  it("contents: auto keeps the template's choice, off removes it, on carries the depth", () => {
    expect(toMarkdownOptions(panel({ toc: "auto" })).toc).toBeUndefined();
    expect(toMarkdownOptions(panel({ toc: "off" })).toc).toBe(false);
    expect(toMarkdownOptions(panel({ toc: "on", tocDepth: 2 })).toc).toEqual({ depth: 2 });
  });

  it("maths is passed only when switched on and loaded", () => {
    const math = { render: () => "", css: "" };
    expect(toMarkdownOptions(panel({ math: true }), math).math).toBe(math);
    expect(toMarkdownOptions(panel({ math: false }), math).math).toBeUndefined();
    expect(toMarkdownOptions(panel({ math: true })).math).toBeUndefined(); // still loading
  });

  it("works through the real converter: the panel's template beats the front matter's, 'auto' follows it", () => {
    const md = "---\ntitle: T\ntemplate: report\n---\n# H";
    const withPanel = markdownToDocument(md, toMarkdownOptions(panel({ template: "book" })));
    expect(withPanel.settings.template).toBe("book");
    expect(withPanel.html).toContain("size: A5");
    const auto = markdownToDocument(md, toMarkdownOptions(panel()));
    expect(auto.settings.template).toBe("report");
    expect(auto.html).toContain("size: A4");
    // the dark theme asks for a painted page
    expect(markdownToDocument(md, toMarkdownOptions(panel({ theme: "dark" }))).renderOptions.pdfBackground).toBe("#0d1117");
  });
});

describe("panel <-> URL", () => {
  it("writes only what differs from the default, so the default panel is an empty query", () => {
    expect(panelToParams(panel()).toString()).toBe("");
    expect(panelToParams(panel({ template: "book", theme: "dark", outline: false })).toString()).toBe("template=book&theme=dark&outline=false");
  });

  it("round-trips every field", () => {
    const full = panel({
      template: "report",
      theme: "dark",
      pageSize: "A4",
      accent: "#c2410c",
      font: "serif",
      stamp: "社外秘 DRAFT",
      cover: "off",
      toc: "on",
      tocDepth: 5,
      outline: false,
      math: false,
      highlight: false,
      width: 900,
    });
    expect(panelFromParams(panelToParams(full))).toEqual(full);
  });

  it("falls back to the default for a missing or invalid value", () => {
    const p = panelFromParams(new URLSearchParams("theme=blue&cover=maybe&tocDepth=99&width=5&outline=perhaps&math=1"));
    expect(p).toEqual(DEFAULT_PANEL);
  });
});
