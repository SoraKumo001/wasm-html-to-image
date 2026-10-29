---
sidebar_position: 4
title: Multi-Page PDF Reports
---

# Multi-Page PDF Reports

Generate multi-page vector PDF documents by supplying an array of HTML strings (`string[]`).

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const pages = [
  `<div style="padding: 40px; font-family: sans-serif;">
    <h1>Monthly Summary</h1>
    <p>Page 1 Overview</p>
  </div>`,
  `<div style="padding: 40px; font-family: sans-serif;">
    <h2>Detailed Statistics</h2>
    <p>Page 2 Content</p>
  </div>`,
];

const pdf = await render({
  value: pages,
  width: 595, // A4 width (pt)
  height: 842, // A4 height (pt)
  format: "pdf",
  mediaType: "print",
  pdfTitle: "Report 2026",
});

await fs.writeFile("report.pdf", Buffer.from(pdf));
```

## Header / Footer

Pass HTML templates through `pdfHeader` / `pdfFooter` to redraw them on every page.
`{{pageNumber}}` and `{{totalPages}}` in the template are replaced per page.

```typescript
const pdf = await render({
  value: html,
  format: "pdf",
  pdfFooter: `<div style="text-align:center">{{pageNumber}} / {{totalPages}}</div>`,
  pdfMargin: { top: 24, bottom: 32, left: 24, right: 24 },
});
```

The footer is normally drawn inside the `pdfMargin.bottom` band. If the measured footer
height exceeds `pdfMargin.bottom` (including the default `0`), the band is widened to the
footer height and the content area shrinks by the same amount, which can increase the
page count. A footer that fits inside the margin keeps the previous placement and page
count.

---

## Generating Professional PDF Reports from Markdown

Instead of writing HTML from scratch, you can use `wasm-html-to-image/markdown` to automatically build PDFs complete with cover pages, tables of contents, headers, footers, and bookmarks from Markdown.

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";
import { markdownToDocument } from "wasm-html-to-image/markdown";

const markdown = `---
title: Project Progress Report
subtitle: Q4 2026
author: Engineering Directorate
date: 2026-10-29
template: report
accent: "#1e40af"
stamp: CONFIDENTIAL
---

# 1. Introduction

This report summarises current system migration progress and upcoming milestones.

# 2. Status

| Milestone | Target Date | Status |
| :--- | :--- | :--- |
| Architecture Review | 2026/09/15 | Complete |
| PoC Validation | 2026/10/20 | Complete |
| Production Rollout | 2026/11/30 | In Progress |

# 3. Risk Assessment & Mitigations

Details and mitigation strategies are outlined below.
`;

// markdownToDocument provides the rendered HTML along with PDF metadata & running header/footer
const { html, renderOptions } = markdownToDocument(markdown, {
  paged: true, // Enable page margins and pagination optimization
});

const { data: pdfData } = await render({
  value: html,
  format: "pdf",
  ...renderOptions,
});

await fs.writeFile("progress-report.pdf", Buffer.from(pdfData));
```

### CLI Quick Command

You can generate the same PDF from the command line in a single command:

```bash
# Basic conversion (auto TOC & bookmarks)
npx wasm-html-to-image progress-report.md -o progress-report.pdf

# Specify template, accent colour, and stamp
npx wasm-html-to-image progress-report.md -o progress-report.pdf --template report --accent "#1e40af" --stamp CONFIDENTIAL
```


