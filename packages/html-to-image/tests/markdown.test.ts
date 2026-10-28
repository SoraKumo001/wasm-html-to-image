import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markdownStylesheet, markdownToHtml } from "../src/markdown";
import { buildRenderOptions, isInlineMarkdown, isMarkdownPath } from "../src/cli-options";

describe("markdownToHtml", () => {
  it("renders GitHub flavoured Markdown inside a styled document", () => {
    const html = markdownToHtml(
      "# Title\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n",
      { title: "A <b>" },
    );
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>A &lt;b&gt;</title>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<article class="markdown-body">');
  });

  it("themes and extends the stylesheet", () => {
    expect(markdownToHtml("x", { theme: "dark" })).toContain("background: #0d1117");
    expect(markdownToHtml("x", { css: "h1{color:red}" })).toContain("h1{color:red}</style>");
    expect(markdownToHtml("x", { stylesheet: "p{}", theme: "dark" })).not.toContain("#0d1117");
    expect(markdownStylesheet("light", 10, 600)).toContain("max-width: 600px");
  });

  it("needs nothing but `marked`, so it runs in browsers and Workers", () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL("../src/markdown.ts", import.meta.url)),
      "utf8",
    );
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["marked"]);
    expect(source).not.toMatch(/\bprocess\.|\brequire\(|node:/);
  });
});

describe("markdown CLI input", () => {
  const flags = { width: 800, format: "png" as const, quality: 85 };

  it("recognises Markdown paths and inline text", async () => {
    expect(isMarkdownPath("doc/README.md")).toBe(true);
    expect(isMarkdownPath("a.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("a.html")).toBe(false);
    expect(isMarkdownPath("https://example.com/a.md")).toBe(false);
    expect(await isInlineMarkdown("# hi", { markdown: true })).toBe(true);
    expect(await isInlineMarkdown("# hi", {})).toBe(false);
  });

  it("converts a .md file and inline --markdown text before rendering", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-"));
    const file = path.join(dir, "a.md");
    fs.writeFileSync(file, "# From file\n");
    const fromFile = await buildRenderOptions(file, flags);
    expect(String(fromFile.value)).toContain("<h1>From file</h1>");
    expect(fromFile.baseUrl).toBe(dir);
    const inline = await buildRenderOptions("**bold**", { ...flags, markdown: true, markdownTheme: "dark" });
    expect(String(inline.value)).toContain("<strong>bold</strong>");
    expect(String(inline.value)).toContain("#0d1117");
    await expect(
      buildRenderOptions("x", { ...flags, markdown: true, markdownTheme: "blue" }),
    ).rejects.toThrow(/unsupported markdown theme/);
  });
});
