import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../src/markdown";
import { buildRenderOptions, type CliFlags } from "../src/cli-options";

const MD = "# Title\n\n## 概要 Overview\n\n## Setup\n\n### Deep *one*\n\n#### Four\n\n## Setup\n";
const article = (html: string) => /<article class="markdown-body">([\s\S]*)<\/article>/.exec(html)![1];
const toc = (html: string) => /<nav class="toc">[\s\S]*?<\/nav>/.exec(html)?.[0];
const rows = (html: string) => [...(toc(html) ?? "").matchAll(/<a class="toc-item toc-l(\d)" href="#([^"]+)">/g)].map((m) => [+m[1], m[2]]);

describe("heading ids", () => {
  it("gives every heading a slug id: any script, lower-cased, duplicates numbered", () => {
    const body = article(markdownToHtml(MD, { toc: false }));
    expect(body).toContain('<h1 id="title">Title</h1>');
    expect(body).toContain('<h2 id="概要-overview">概要 Overview</h2>');
    expect(body).toContain('<h2 id="setup">Setup</h2>');
    expect(body).toContain('<h2 id="setup-2">Setup</h2>');
    expect(body).toContain('<h3 id="deep-one">');
  });

  it("builds the id from the text, not the markup, and never leaves it empty", () => {
    const body = article(markdownToHtml("## `code` & <b>bold</b>!\n\n## ???\n", { toc: false }));
    expect(body).toContain('id="code-bold"');
    expect(body).toContain('id="section"');
  });
});

describe("table of contents", () => {
  it("is on for paged (PDF) output and lists every heading down to depth 3 by default", () => {
    const html = markdownToHtml(MD, { paged: true });
    expect(rows(html)).toEqual([[1, "title"], [2, "概要-overview"], [2, "setup"], [3, "deep-one"], [2, "setup-2"]]);
    // Each row carries the element the renderer fills the page number into, keyed by the heading id.
    expect(toc(html)).toContain('<span class="toc-page" data-toc-page="setup-2">0</span>');
    expect(toc(html)).toContain('<p class="toc-title">Contents</p>');
    expect(toc(html)).toContain("<em>one</em>"); // inline markup of the heading is kept
    expect(html.indexOf('<nav class="toc">')).toBeLessThan(html.indexOf('<h1 id="title">'));
  });

  it("is off for images unless asked for, and switched off by toc: false", () => {
    expect(toc(markdownToHtml(MD))).toBeUndefined();
    expect(toc(markdownToHtml(MD, { paged: true, toc: false }))).toBeUndefined();
    expect(rows(markdownToHtml(MD, { toc: true })).length).toBe(5);
  });

  it("takes a depth and a title; an empty title leaves it out", () => {
    const html = markdownToHtml(MD, { paged: true, toc: { depth: 1, title: "目次" } });
    expect(rows(html)).toEqual([[1, "title"]]);
    expect(toc(html)).toContain('<p class="toc-title">目次</p>');
    expect(toc(markdownToHtml(MD, { paged: true, toc: { title: "" } }))).not.toContain("toc-title");
    expect(rows(markdownToHtml(MD, { paged: true, toc: { depth: 6 } })).length).toBe(6);
  });

  it("is not added to a document without headings", () => {
    expect(toc(markdownToHtml("just text", { paged: true }))).toBeUndefined();
  });
});

describe("table of contents from the CLI", () => {
  const flags: CliFlags = { width: 800, format: "pdf", quality: 85 };
  const html = async (extra: Partial<CliFlags>, format: CliFlags["format"] = "pdf") =>
    String((await buildRenderOptions("# A\n\n## B\n", { ...flags, ...extra, format, markdown: true })).value);

  it("adds it to a PDF by default, not to an image, and honours --no-toc and --toc-depth", async () => {
    expect(toc(await html({}))).toBeDefined();
    expect(toc(await html({}, "png"))).toBeUndefined();
    expect(toc(await html({ toc: false }))).toBeUndefined();
    expect(rows(await html({ tocDepth: 1 }))).toEqual([[1, "a"]]);
  });

  it("passes --no-outline on as pdfOutline: false (on by default)", async () => {
    const withOutline = await buildRenderOptions("# A", { ...flags, markdown: true });
    expect(withOutline.pdfOutline).toBeUndefined();
    const without = await buildRenderOptions("# A", { ...flags, markdown: true, outline: false });
    expect(without.pdfOutline).toBe(false);
  });
});
