---
sidebar_position: 3
title: Compatibility & Specifications
---

# Compatibility & Specifications

Supported input types, output formats, CSS properties, and runtime environments.

## 1. Format Matrix

### Inputs (`value`)

| Input                 | Detection                 | Description                                                |
| --------------------- | ------------------------- | ---------------------------------------------------------- |
| **HTML String**       | Text string with tags     | Regular HTML/CSS rendering                                 |
| **HTML String Array** | `string[]`                | Multi-page PDF generation                                  |
| **URL**               | `http://` or `https://`   | Auto-fetches and renders remote HTML                       |
| **Image Buffer**      | `Uint8Array` / `Buffer`   | Magic-byte recognition for PNG, JPEG, WebP, GIF, AVIF, BMP |
| **Data URL**          | `data:image/*;base64,...` | Bypasses HTML path, routed to image optimization pipeline  |

### Outputs (`format`)

| Format      | Return Type  | From HTML                                      | From Image                    |
| ----------- | ------------ | ---------------------------------------------- | ----------------------------- |
| `png`       | `Uint8Array` | Skia render → PNG encode                       | Decodes and outputs PNG       |
| `jpeg`      | `Uint8Array` | Skia render → JPEG encode (`quality`)          | Decodes and compresses JPEG   |
| `webp`      | `Uint8Array` | Skia render → WebP encode (`quality`)          | Decodes and compresses WebP   |
| `avif`      | `Uint8Array` | Skia render → AVIF encode (`quality`, `speed`) | Decodes and compresses AVIF   |
| `jxl`       | `Uint8Array` | Skia render → JXL encode (`quality`, `speed`)  | Decodes and compresses JXL (output-only; JXL input decoding is not supported) |
| `raw`       | `Uint8Array` | Uncompressed RGBA pixels                       | Uncompressed RGBA pixels      |
| `thumbhash` | `Uint8Array` | Computes ThumbHash from render                 | Computes ThumbHash from image |
| `svg`       | `string`     | Skia vector stream                             | Wraps in `<image>` SVG        |
| `pdf`       | `Uint8Array` | SkPDFDocument vector PDF                       | Single-page centered PDF      |

---

## 2. CSS Features

- **Box Model**: Margins, paddings, borders, box-sizing, and logical properties (`margin-inline`, etc.).
- **Flexbox**: Multi-pass resolution conforming to W3C Flexbox specs.
- **Grid Layout**: Basic grid tracks, placement, and gaps.
- **Typography**: HarfBuzz shaping, bidirectional text (BiDi), line-breaking for CJK, Latin, Arabic, and Emoji.
- **Effects**: Box shadows, border-radii, transforms, opacity, and clip paths (`circle`, `ellipse`, `polygon`, `path`).
- **Media & Containers**: `@media print` and container queries (`@container`).

---

## 3. Runtime Compatibility

- **Node.js (>=20)**: Full support across single, multi-threaded worker pools, and explicit modules.
- **Cloudflare Workers**: Full support via `wasm-html-to-image/workerd`.
- **Vercel Edge Runtime**: Full support via `wasm-html-to-image/edge-light`.
- **Browsers**: Runs client-side or within Web Workers.
- **Deno & Bun**: Fully compatible.
