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

