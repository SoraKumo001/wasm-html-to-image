---
sidebar_position: 4
title: Fonts & Resource Resolution
---

# Fonts & Resource Resolution

How wasm-html-to-image loads, caches, and shapes external images and web fonts.

## 1. Automatic Google Fonts Loading

Generic font-family declarations like `sans-serif` and specific Google Fonts like `Inter` are automatically downloaded in WOFF2 format using Chrome-compatible headers and cached in memory.

```typescript
import { render } from "wasm-html-to-image/single";

const png = await render({
  value: `<div style="font-family: 'Roboto', sans-serif;">Hello Typography</div>`,
  width: 800,
  format: "png",
});
```

---

## 2. Inlined Custom Fonts (`fallbackFonts`)

Inject raw font buffers or data URLs for offline or air-gapped environments:

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const fontData = await fs.readFile("./fonts/CustomFont.ttf");

const png = await render({
  value: "<h1>Custom Inlined Font</h1>",
  width: 800,
  format: "png",
  fallbackFonts: [fontData],
});
```
