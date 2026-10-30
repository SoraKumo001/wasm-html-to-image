import { describe, expect, it } from "vitest";
import { render } from "wasm-html-to-image/single";
import { listTemplates, markdownToDocument } from "wasm-html-to-image/markdown";

const DOC = `---
title: Template check
subtitle: Every bundled template
author: Tester
date: 2026-10-30
stamp: DRAFT
---

# Chapter one

Body text with **bold**, \`code\` and a [link](#chapter-one).

## Section

> [!NOTE]
> A call-out box.

| Item | Value |
|---|---:|
| One | 1 |
| Two | 2 |

\`\`\`ts
const answer = 42;
\`\`\`

## Another section

- first
- second

# Chapter two

More text on a later page.
`;

const pdfjs = async (data: Uint8Array) => {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await lib.getDocument({ data: new Uint8Array(data), useSystemFonts: false, isEvalSupported: false }).promise;
  const page = async (n: number) => {
    const p = await doc.getPage(n);
    const text = (await p.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    const v = p.getViewport({ scale: 1 });
    return { text, width: v.width, height: v.height };
  };
  return { pages: doc.numPages, page };
};

// Every bundled template, light and dark: it must produce a PDF whose pages all have text, a cover without
// running header and footer, and the page shape (A4 landscape for slides) the template asks for.
describe("bundled Markdown templates", () => {
  for (const { name } of listTemplates()) {
    for (const theme of ["light", "dark"] as const) {
      it(`${name} (${theme})`, async () => {
        const doc = markdownToDocument(DOC, { template: name, theme, paged: true });
        const pdf = (await render({ value: doc.html, width: 794, format: "pdf", pdfOutline: false, ...doc.renderOptions })).data as Uint8Array;
        const r = await pdfjs(pdf);
        expect(r.pages).toBeGreaterThan(0);
        for (let n = 1; n <= r.pages; n++) expect((await r.page(n)).text.trim().length, `page ${n}`).toBeGreaterThan(0);

        const first = await r.page(1);
        if (name === "slides") expect(first.width).toBeGreaterThan(first.height);
        else expect(first.height).toBeGreaterThan(first.width);

        const footer = /\d+ \/ \d+/;
        if (doc.settings.cover) {
          expect(first.text).toContain("Template check");
          expect(first.text, "the cover has no running footer").not.toMatch(footer);
          expect(first.text, "the cover has no stamp header").not.toContain("DRAFT");
        }
      });
    }
  }
});
