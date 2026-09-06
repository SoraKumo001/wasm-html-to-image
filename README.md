# wasm-html-to-image

[![npm version](https://img.shields.io/npm/v/wasm-html-to-image.svg)](https://www.npmjs.com/package/wasm-html-to-image)
[![npm downloads](https://img.shields.io/npm/dw/wasm-html-to-image.svg)](https://www.npmjs.com/package/wasm-html-to-image)
[![license](https://img.shields.io/npm/l/wasm-html-to-image.svg)](https://github.com/SoraKumo001/wasm-html-to-image/blob/master/LICENSE)
[![Playground](https://img.shields.io/badge/Demo-Playground-blueviolet)](https://sorakumo001.github.io/wasm-html-to-image/master)
[![Documentation](https://img.shields.io/badge/Docs-Docusaurus-blue)](https://sorakumo001.github.io/wasm-html-to-image/master/docs)

A high-performance, WebAssembly-powered HTML-to-image renderer and image optimization engine. It consolidates HTML rendering (**Satoru** / **Skia** / **litehtml**) and native image encoding (**WebP / AVIF / JPEG**) into a single, unified WASM binary.

No headless browsers (Chromium, Puppeteer, or Playwright) required. Runs seamlessly across Node.js, Cloudflare Workers, Edge runtimes, browsers, and the CLI.

---

## ✨ Features

- ⚡ **Single Unified WASM Binary**: HTML parsing, CSS layout, vector painting, and image encoding execute entirely inside WebAssembly without copying intermediate framebuffers across JS boundaries.
- 🎨 **Versatile Inputs**: Renders HTML strings, remote Web URLs, multi-page HTML arrays, or raw image buffers (PNG, JPEG, WebP, GIF, AVIF, BMP, Data URLs).
- 📦 **Rich Output Formats**: Direct SVG vector streams, high-quality PNG, JPEG, WebP, AVIF, uncompressed RAW pixels, ThumbHash placeholders, and multi-page vector PDFs.
- 🚀 **Zero-Config Single Bundle**: Use `wasm-html-to-image/single` to call `render()` immediately without manual WASM loading or build setup.
- 🌐 **Edge & Serverless Native**: Dedicated subpaths (`/workerd` for Cloudflare Workers, `/edge-light` for Vercel Edge) tailored for strict serverless constraints.
- 🧵 **Multi-Threaded Worker Pool**: Process thousands of images in parallel using `wasm-html-to-image/workers` (Node.js worker threads / Web Workers).
- ⚛️ **Ecosystem Ready**: First-class support for React / Preact JSX components and Tailwind CSS inlined styling.

---

## 📦 Installation

```bash npm2yarn
npm install wasm-html-to-image
```

---

## 🚀 Quick Start

### Zero-Config Rendering (`wasm-html-to-image`)

The easiest way to get started. WASM is embedded and loaded automatically (in Cloudflare Workers, the workerd-optimized module is automatically selected):

```typescript
import { render } from "wasm-html-to-image";

// 1. Render HTML to PNG (returns RenderResult with .data and dimensions)
const result = await render({
  value: `<div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 40px; color: white; border-radius: 16px; font-family: sans-serif;">
    <h1 style="margin: 0; font-size: 32px;">Hello wasm-html-to-image</h1>
    <p style="margin-top: 8px; opacity: 0.9;">High-performance serverless rendering</p>
  </div>`,
  width: 800,
  format: "png",
});

console.log(result.data); // Uint8Array
console.log(result.width, result.height); // 800, 600

// 2. Convert and resize image with the same render() function
const webp = await render({
  value: result.data, // Pass raw image buffer directly
  width: 400, // Target resized width
  format: "webp",
  quality: 80,
});

console.log(webp.originalWidth, webp.originalHeight); // Original image dimensions
console.log(webp.width, webp.height); // Output image dimensions
```

---

## 🖼️ Image-to-Image Conversion & Optimization

`wasm-html-to-image` is not only an HTML renderer — it also serves as a high-speed, self-contained **image-to-image converter, resizer, and compressor** without requiring heavy native libraries like Sharp or ImageMagick.

Simply pass raw image bytes (`Uint8Array` or `Buffer`) or a `data:image/...` URL to `render()`. It automatically identifies input magic bytes, skips the HTML layout pass, and routes straight into the native Skia image pipeline. Every call returns rich metadata (`width`, `height`, `originalWidth`, `originalHeight`, `format`, `isAnimated`) along with the output data in `.data`:

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const imageBuffer = await fs.readFile("photo.jpg");

// 1. Convert JPEG -> AVIF (highest compression)
const avif = await render({
  value: imageBuffer,
  width: 800,
  format: "avif",
  quality: 75,
  speed: 6, // 0 (best quality) - 10 (fastest)
});
await fs.writeFile("photo.avif", Buffer.from(avif.data));

// 2. Crop & Resize -> PNG
const cropped = await render({
  value: imageBuffer,
  crop: { x: 50, y: 50, width: 300, height: 300 },
  width: 150,
  height: 150,
  format: "png",
});
await fs.writeFile("cropped.png", Buffer.from(cropped.data));

// 3. Generate ThumbHash Blur Placeholder
const thumbhash = await render({
  value: imageBuffer,
  width: 100,
  format: "thumbhash",
});
console.log("ThumbHash bytes:", thumbhash.data);

// 4. Convert Image -> Single-Page Vector PDF
const pdf = await render({
  value: imageBuffer,
  format: "pdf",
});
await fs.writeFile("photo.pdf", Buffer.from(pdf.data));

// 5. Convert Animated GIF -> Animated WebP
const animatedWebp = await render({
  value: await fs.readFile("animation.gif"),
  format: "webp",
  animation: true,
});
await fs.writeFile("animation.webp", Buffer.from(animatedWebp.data));
```

---

## 📊 Format Matrix

### Inputs (`value` / `url`)

| Input Type                  | Detection                        | Description                                                |
| --------------------------- | -------------------------------- | ---------------------------------------------------------- |
| **HTML String**             | Text starting with tags / markup | Standard HTML/CSS rendering                                |
| **HTML Array (`string[]`)** | Array of HTML strings            | Multi-page PDF generation (one page per item)              |
| **URL (`url`)**             | `http://` or `https://`          | Automatically fetches and renders remote web pages         |
| **Image Buffer**            | `Uint8Array` / `Buffer`          | Magic-byte recognition for PNG, JPEG, WebP, GIF, AVIF, BMP |
| **Data URL**                | `data:image/*;base64,...`        | Inlined image data URL, routed straight to image pipeline  |

### Outputs (`format`)

All formats return a `RenderResult<T>` object containing `.data` (`Uint8Array` or `string` for SVG) and metadata (`width`, `height`, `originalWidth`, `originalHeight`, `format`, `isAnimated`):

| Format      | `result.data` Type | HTML Input                                     | Image Input                   |
| ----------- | ------------------ | ---------------------------------------------- | ----------------------------- |
| `png`       | `Uint8Array`       | Skia render → PNG encode                       | Decodes and converts to PNG   |
| `jpeg`      | `Uint8Array`       | Skia render → JPEG encode (`quality`)          | Decodes and compresses JPEG   |
| `webp`      | `Uint8Array`       | Skia render → WebP encode (`quality`)          | Decodes and compresses WebP   |
| `avif`      | `Uint8Array`       | Skia render → AVIF encode (`quality`, `speed`) | Decodes and compresses AVIF   |
| `raw`       | `Uint8Array`       | Uncompressed RGBA pixel bytes                  | Uncompressed RGBA pixel bytes |
| `thumbhash` | `Uint8Array`       | Computes ThumbHash from render                 | Computes ThumbHash from image |
| `svg`       | `string`           | Skia vector drawing stream                     | Single `<image>` wrapper SVG  |
| `pdf`       | `Uint8Array`       | SkPDFDocument vector PDF                       | Single-page centered PDF      |

---

## 🧩 Subpaths & Usage

Choose the optimal entry point for your application and environment:

| Subpath                         | Target Environment                       | Highlights                                                             |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `wasm-html-to-image`            | Universal (Node, Edge, Cloudflare, Deno) | Zero-config default: auto routes to single/workerd, instant `render()` |
| `wasm-html-to-image/single`     | Node.js, Bundlers                        | Single bundled WASM entry point                                        |
| `wasm-html-to-image/index`      | High-throughput servers                  | Explicit `loadHtmlToImageModule()` & manual instance reuse             |
| `wasm-html-to-image/workerd`    | Cloudflare Workers                       | WebAssembly.Module compilation compatible                              |
| `wasm-html-to-image/edge-light` | Vercel Edge Runtime                      | Optimized for Edge Runtime constraints                                 |
| `wasm-html-to-image/workers`    | Node.js, Browsers                        | Multi-threaded worker pool for high concurrency                        |
| `wasm-html-to-image/react`      | React integration                        | Directly render React JSX element trees                                |
| `wasm-html-to-image/preact`     | Preact integration                       | Directly render Preact JSX element trees                               |
| `wasm-html-to-image/tailwind`   | Utility styling                          | Inlines UnoCSS / Tailwind classes                                      |

---

## 💡 Practical Examples

### 1. High-Throughput Node.js Server (Instance Reuse)

Reuse the WASM module across incoming HTTP requests for maximum performance:

```typescript
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image";
import express from "express";

const app = express();
const mod = await loadHtmlToImageModule(); // Load once at startup

app.get("/ogp", async (req, res) => {
  const result = await htmlToImage(mod, {
    value: `<h1>${req.query.title}</h1>`,
    width: 1200,
    height: 630,
    format: "webp",
    quality: 85,
  });

  res.type("image/webp").send(Buffer.from(result.data));
});

app.listen(3000);
```

### 2. Cloudflare Workers (`workerd`)

Generate dynamic social preview images at the edge:

```typescript
// wrangler.jsonc:
// { "rules": [{ "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": false }] }

import { render } from "wasm-html-to-image/workerd";

export default {
  async fetch(request: Request): Promise<Response> {
    const result = await render({
      value: `<div style="padding: 40px; font-family: sans-serif; background: #0f172a; color: white;">
        <h1>Edge OGP Generator</h1>
      </div>`,
      width: 1200,
      height: 630,
      format: "png",
    });

    return new Response(result.data, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
```

### 3. Multi-Threaded Batch Generation (`workers`)

Leverage multi-core CPUs to process large batches of images in parallel:

```typescript
import { render } from "wasm-html-to-image/workers";

const tasks = items.map((item) =>
  render({
    value: `<h1>${item.title}</h1>`,
    width: 600,
    height: 400,
    format: "webp",
  }),
);

const images = await Promise.all(tasks);
```

### 4. Command Line Interface (CLI)

Render directly from your shell without writing code:

```bash
# Render HTML to WebP
npx wasm-html-to-image template.html -o banner.webp -w 1200 -h 630 -f webp -q 90

# Capture screenshot from URL
npx wasm-html-to-image https://example.com -o site.png -w 1280 -h 720

# Convert and resize an image
npx wasm-html-to-image photo.jpg -o photo.avif -w 800 -f avif -q 80
```

---

## 📖 Documentation

For full guides, architecture deep-dives, font management, and advanced recipes:

👉 **[Read the Official Documentation](https://sorakumo001.github.io/wasm-html-to-image/master/docs/)**

- [Overview & Getting Started](https://sorakumo001.github.io/wasm-html-to-image/master/docs/docs/overview)
- [Architecture & Pipelines](https://sorakumo001.github.io/wasm-html-to-image/master/docs/docs/architecture)
- [API Reference](https://sorakumo001.github.io/wasm-html-to-image/master/docs/docs/api-reference)
- [Runtime Guide (Node / Workers / Edge / Browser)](https://sorakumo001.github.io/wasm-html-to-image/master/docs/docs/api-reference/runtime-guide)
- [Production Recipes](https://sorakumo001.github.io/wasm-html-to-image/master/docs/docs/recipes/ogp-production)

---

## 🛠️ Development

<details>
<summary>Click to view repository build and test instructions</summary>

### Prerequisites

- Node.js >= 20, pnpm >= 9
- Emscripten SDK (emsdk), CMake, Ninja, vcpkg (for C++ WASM builds)

### Building

```bash
# Install workspace dependencies
pnpm install

# Build TypeScript packages
pnpm --filter wasm-html-to-image build
pnpm build:js

# Build Documentation
pnpm docs:build
```

### Testing

```bash
# Unit tests (Vitest)
pnpm --filter wasm-html-to-image test

# Visual regression tests
pnpm --filter visual-test test
```

</details>

---

## 📄 License

MIT © [SoraKumo](https://github.com/SoraKumo001)
