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

> `webp` produces an animated WebP when `animation: { duration, fps, loop }` (CLI: `--animation`) is set. `opacity`, `transform` (`translate` / `rotate` / `scale` only) and `color` / `background-color` `@keyframes` are sampled; the default is 15 fps with caps of 5 s (`duration` is clamped to 5000 ms) / ~75 frames. The repeat count is set with `loop` (CLI: `--animation-loop`) and defaults to `0` (infinite).

---

## 2. CSS & Layout Features

- **Box Model**: Margins, paddings, borders, box-sizing (`border-box`, `content-box`), `aspect-ratio`, and logical properties (`margin-inline`, `padding-block`, etc.).
- **Flexbox**: Multi-pass resolution conforming to W3C Flexbox specs (`flex-direction`, `justify-content`, `align-items`, `flex-wrap`, `gap`, `row-gap`, `column-gap`, etc.).
- **Grid Layout**: Grid tracks (`grid-template-columns/rows`), item placement (`grid-column/row`), `place-items`, `gap`.
- **Typography & Internationalization**: HarfBuzz text shaping, bidirectional text (BiDi), line-breaking for CJK, Latin, Arabic, and Emoji. Vertical text (`writing-mode: vertical-rl`), multi-line truncation (`-webkit-line-clamp` / `text-overflow: ellipsis`), `text-transform`, and text stroke (`-webkit-text-stroke`). Fonts for scripts missing from Noto Sans JP (Hangul, Hebrew, Arabic, Thai, Devanagari, Greek) and for color emoji are fetched on demand from external CDNs (Google Fonts / jsDelivr) only when such characters appear.
- **Visual Effects**: Box shadows (multiple shadows, inset), border-radii (elliptical, individual corners), transforms, opacity, filters (`blur`, `drop-shadow`), backdrop filters, and blend modes (`mix-blend-mode`, `background-blend-mode`).
- **Clipping & Shapes**: Native Skia vector clipping paths (`circle()`, `ellipse()`, `polygon()`, `path()`, `inset()`), and alpha masks (`mask`, `mask-image`, `mask-size`, `mask-repeat`, `mask-position`; images and gradients, tiled).
- **Inline SVG**: Direct embedded `<svg>` rendering with `<path>`, `<rect>`, `<circle>`, `<g>`, `<linearGradient>`, etc. via SkSVGDOM.
- **Modern CSS**: `calc()`, `light-dark()`, CSS Variables (`var(--name)`), cascade layers (`@layer`).
- **Selectors & Pseudo-elements**: ID, class, attributes, `:nth-child()`, `:not()`, `:is()`, `:where()`, `:has()`, `::before`, `::after` (`content`).
- **Media & Containers**: `@media screen`, `@media print`, and container queries (`@container`).

---

## 3. Unsupported Features & Limitations (AI Guidelines)

`wasm-html-to-image` is a lightweight static renderer based on **litehtml** and **Skia**, not a headless browser. Keep the following constraints in mind when writing templates:

1. **NO JavaScript**: `<script>` tags, DOM event listeners, and DOM APIs do not run.
2. **Partial CSS Animation Support**: `transition` is not evaluated. `@keyframes` are ignored by default (only static styles paint), but passing `animation: { duration, fps, loop }` (CLI: `--animation`) samples **`opacity`, `transform` and `color` / `background-color` `@keyframes`** into an animated WebP. The repeat count is set with `loop` (CLI: `--animation-loop`, default `0` = infinite). Defaults are 15 fps with caps of 5 s (`duration` is clamped to 5000 ms) / ~75 frames. `transform` supports `translate` / `rotate` / `scale` only; when the function list differs between the keyframes the element keeps its static transform. Per-keyframe easing, several animations on one element and `animation-direction` / `animation-fill-mode` are out of scope.
3. **NO Canvas Scripting**: `<canvas>` element 2D/WebGL contexts do not execute. Use inline `<svg>` or CSS shapes instead.
4. **NO Interactive States**: `:hover`, `:active`, and `:focus` states do not trigger.
5. **NO Browser Web Storage**: `window`, `document`, `localStorage`, and `IndexedDB` are unavailable.

---

## 4. Runtime Compatibility

- **Node.js (>=20)**: Full support across single, multi-threaded worker pools, and explicit modules.
- **Cloudflare Workers**: Full support via `wasm-html-to-image/workerd`.
- **Vercel Edge Runtime**: Full support via `wasm-html-to-image/edge-light`.
- **Browsers**: Runs client-side or within Web Workers.
- **Deno & Bun**: Fully compatible.
