---
sidebar_position: 5
title: Image Optimization & ThumbHash
---

# Image Optimization & ThumbHash

Use `wasm-html-to-image` as a standalone image compressor, resizer, and placeholder generator.

## Resizing to WebP

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const image = await fs.readFile("photo.jpg");

const webp = await render({
  value: image,
  width: 800,
  format: "webp",
  quality: 80,
  fit: "contain",
});

await fs.writeFile("photo.webp", Buffer.from(webp));
```

---

## ThumbHash Generation

```typescript
const thumbhashBytes = await render({
  value: image,
  width: 100,
  format: "thumbhash",
});
```
