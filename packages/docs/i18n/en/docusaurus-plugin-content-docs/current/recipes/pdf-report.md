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
