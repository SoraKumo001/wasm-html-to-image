---
sidebar_position: 5
title: Image-to-Image Conversion & ThumbHash
---

# Image-to-Image Conversion & ThumbHash

`wasm-html-to-image` functions not only as an HTML renderer but also as a high-performance native engine for **image format conversion, resizing, compression, and ThumbHash generation**.

You can handle common image transformation tasks without pulling in heavy native dependencies like Sharp or ImageMagick.

---

## 1. Supported Input Formats & Conversions

Input image buffers (`Uint8Array` or `Buffer`) are automatically detected via magic bytes:

| Input Format (Auto-detected) | Available Output Formats                                        |
| ---------------------------- | --------------------------------------------------------------- |
| **PNG**                      | `webp`, `avif`, `jxl`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **JPEG**                     | `webp`, `avif`, `jxl`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **WebP**                     | `avif`, `jxl`, `webp`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **GIF** (including animated) | `webp` (with animation), `png`, `jpeg`, `avif`, `jxl`, etc.            |
| **AVIF**                     | `webp`, `jxl`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf`         |
| **BMP**                      | `webp`, `avif`, `jxl`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |

---

## 2. Practical Code Examples

### A. Convert JPEG/PNG to WebP / AVIF

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const inputImage = await fs.readFile("photo.jpg");

// Convert JPEG -> WebP (quality: 80)
const webp = await render({
  value: inputImage,
  width: 800,
  format: "webp",
  quality: 80,
  fit: "contain",
});
await fs.writeFile("photo.webp", Buffer.from(webp));

// Convert JPEG -> AVIF (highest compression)
const avif = await render({
  value: inputImage,
  width: 800,
  format: "avif",
  quality: 75,
  speed: 6, // 0 (slowest, best quality) to 10 (fastest)
});
await fs.writeFile("photo.avif", Buffer.from(avif));
```

---

### B. Cropping & Resizing

```typescript
// Crop a 400x400 area starting from (100, 100), then scale down to 200x200
const cropped = await render({
  value: inputImage,
  crop: { x: 100, y: 100, width: 400, height: 400 },
  width: 200,
  height: 200,
  format: "png",
});
```

---

### C. Convert Animated GIF to Animated WebP

Set `animation: true` to preserve all frames in the output:

```typescript
const gifData = await fs.readFile("animation.gif");

const animatedWebp = await render({
  value: gifData,
  format: "webp",
  quality: 75,
  animation: true,
});

await fs.writeFile("animation.webp", Buffer.from(animatedWebp));
```

---

### D. ThumbHash Placeholder Generation

```typescript
const thumbhashBytes = await render({
  value: inputImage,
  width: 100,
  format: "thumbhash",
});

console.log("ThumbHash bytes:", thumbhashBytes);
```

---

### E. Convert Image to Vector SVG / PDF

```typescript
// Output as SVG (returns string)
const svgString = await render({
  value: inputImage,
  width: 600,
  format: "svg",
});

// Output as single-page PDF (returns Uint8Array)
const pdfBuffer = await render({
  value: inputImage,
  format: "pdf",
});
```
