---
sidebar_position: 10
title: 2D Canvas API (createCanvas)
---

# 2D Canvas API (`createCanvas`)

You can drive the internal Skia CPU rasterizer directly from JavaScript/TypeScript to perform HTML5 Canvas 2D-compatible imperative drawing, image compositing, and filter effects—even in runtimes without a DOM or WebGL (Node.js, Web Workers, Cloudflare Workers).

:::info About `<canvas>` elements inside HTML
`createCanvas()` documented here is a standalone programmatic API. Executing `canvas.getContext('2d')` scripts inside HTML documents via `applyJavaScript` remains unsupported.
:::

---

## 1. Quick Start

```typescript
import {
  CanvasPath2D,
  createCanvas,
  htmlToImage,
  loadHtmlToImageModule,
} from "wasm-html-to-image";

const mod = await loadHtmlToImageModule();
const canvas = createCanvas(mod, 800, 450);

try {
  const ctx = canvas.getContext("2d");

  // Linear gradient background
  const grad = ctx.createLinearGradient(0, 0, 800, 450);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(1, "#1e293b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 450);

  // Rounded rectangle with drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(40, 180, 720, 220, 16);
  ctx.fill();
  ctx.restore();

  // CanvasPath2D with SVG path string
  ctx.fillStyle = "#38bdf8";
  ctx.fill(new CanvasPath2D("M 100 220 L 140 300 L 60 300 Z"));

  // Composite an HTML render onto the Canvas
  const header = await htmlToImage(mod, {
    value: `<div style="color: white; font-family: sans-serif; font-size: 28px;">Canvas + HTML</div>`,
    width: 720,
    format: "png",
  });
  if (header.data instanceof Uint8Array) {
    ctx.drawImage(header.data, 40, 40);
  }

  // Encode to PNG / WebP / JPEG / AVIF, etc.
  const pngBytes = canvas.encode({ format: "png" });
  const webpBytes = canvas.encode({ format: "webp", quality: 90 });
} finally {
  // Always release the WASM instance (Symbol.dispose / `using` is also supported)
  canvas.dispose();
}
```

---

## 2. API Reference

### `createCanvas(module, width?, height?)` / `Canvas`

| Method / Property | Description |
| :--- | :--- |
| `width` / `height` | Canvas dimensions in pixels (default `300 × 150`). Assigning resets the backing bitmap and context state. |
| `getContext("2d")` | Returns the `CanvasRenderingContext2D` instance (returns `null` for any other context ID). |
| `encode(options?)` | Encodes the current bitmap into a `Uint8Array`. `options`: `{ format?: OutputFormat, quality?: number, speed?: number }` (defaults to `format: "png"`). |
| `toDataURL(type?, quality?)` | Returns a Data URL string for `"image/png"`, `"image/jpeg"`, `"image/webp"`, or `"image/avif"`. |
| `toConverter(converterInst)` | Copies the current bitmap into an `ImageConverterInstance`. |
| `dispose()` / `[Symbol.dispose]()` | Releases the underlying WASM `CanvasInstance`. |

### `CanvasRenderingContext2D` Supported Features

* **State, Transforms & Clipping**: `save()`, `restore()`, `translate()`, `scale()`, `rotate()`, `transform()`, `setTransform()`, `resetTransform()`, `clip()`
* **Rectangles**: `fillRect()`, `strokeRect()`, `clearRect()`
* **Paths**: `beginPath()`, `closePath()`, `moveTo()`, `lineTo()`, `quadraticCurveTo()`, `bezierCurveTo()`, `arc()`, `arcTo()`, `ellipse()`, `rect()`, `roundRect()`, `fill()`, `stroke()`
* **Styles**: `fillStyle` / `strokeStyle` (CSS color strings and `CanvasGradient`), `createLinearGradient()`, `createRadialGradient()`, `createConicGradient()`, `lineWidth`, `lineCap`, `lineJoin`, `miterLimit`, `setLineDash()`, `getLineDash()`, `lineDashOffset`
* **Compositing & Effects**: `globalAlpha`, `globalCompositeOperation` (26 `SkBlendMode` operations including `source-over`, `multiply`, `screen`, `overlay`, etc.), `shadowColor`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `filter` (`blur()`, `brightness()`, `contrast()`, `grayscale()`, `sepia()`, `hue-rotate()`, `invert()`, `opacity()`, `drop-shadow()`)
* **Images & Pixel Data**: `drawImage()` (accepts `Uint8Array`, `ArrayBuffer`, `Canvas`, or `{ converterInst, frameIndex? }`), `imageSmoothingEnabled`, `imageSmoothingQuality`, `createImageData()`, `getImageData()`, `putImageData()`

### `CanvasPath2D`

Construct reusable paths with `new CanvasPath2D(path?)` from an SVG path string (e.g. `"M 0 0 L 100 100 Z"`) or another `CanvasPath2D`, and pass them to `fill(path)`, `stroke(path)`, or `clip(path)`.

---

## 3. Current Limitations

* **Text drawing (`fillText` / `strokeText` / `measureText`)**: Not yet implemented. Render text with `htmlToImage()` and composite it onto the canvas with `ctx.drawImage()`.
* **Patterns (`createPattern`)**: Not yet implemented.
* **SVG / PDF output**: `canvas.encode({ format: "svg" })` and `"pdf"` embed the rasterized canvas bitmap as a single image rather than preserving vector paths.
