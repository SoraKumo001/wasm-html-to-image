---
sidebar_position: 10
title: 2D Canvas API (createCanvas)
---

# 2D Canvas API (`createCanvas`)

`wasm-html-to-image` 内部の Skia CPU ラスタライザを直接操作し、ブラウザの HTML5 Canvas 2D API と同等の命令的描画・画像合成・フィルター加工を行うことができます。Node.js や Web Worker、Cloudflare Workers など DOM / WebGL のない環境でも動作します。

:::tip HTML 内の `<canvas>` 要素との連携
`javascript: { canvas: true }` を指定して `render()` を呼ぶか、`createDOM()` の `beforeStart` 内で `installCanvasBridge(page.dom, module)` を呼ぶことで、HTML 内の `<canvas>` / `OffscreenCanvas` に対する `getContext("2d")` スクリプト実行とレンダリングにも対応します。
:::

---

## 1. 基本的な使い方

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

  // グラデーション背景
  const grad = ctx.createLinearGradient(0, 0, 800, 450);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(1, "#1e293b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 450);

  // シャドウ付き角丸矩形
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(40, 180, 720, 220, 16);
  ctx.fill();
  ctx.restore();

  // SVG パス文字列を使った CanvasPath2D 描画
  ctx.fillStyle = "#38bdf8";
  ctx.fill(new CanvasPath2D("M 100 220 L 140 300 L 60 300 Z"));

  // HTML レンダリング結果を Canvas 上に合成
  const header = await htmlToImage(mod, {
    value: `<div style="color: white; font-family: sans-serif; font-size: 28px;">Canvas + HTML</div>`,
    width: 720,
    format: "png",
  });
  if (header.data instanceof Uint8Array) {
    ctx.drawImage(header.data, 40, 40);
  }

  // PNG / WebP / JPEG / AVIF 等へエンコード
  const pngBytes = canvas.encode({ format: "png" });
  const webpBytes = canvas.encode({ format: "webp", quality: 90 });
} finally {
  // Wasm 側のメモリを必ず解放する (using canvas = ... も利用可能)
  canvas.dispose();
}
```

---

## 2. API リファレンス

### `createCanvas(module, width?, height?)` / `Canvas`

| メソッド / プロパティ | 説明 |
| :--- | :--- |
| `width` / `height` | キャンバスの幅・高さ（ピクセル）。デフォルトは `300 × 150`。値を代入するとリサイズされ、描画内容・状態がクリアされます。 |
| `getContext("2d")` | `CanvasRenderingContext2D` インスタンスを返します（`"2d"` 以外は `null`）。 |
| `encode(options?)` | 現在の描画内容を `Uint8Array` にエンコードします。`options`: `{ format?: OutputFormat, quality?: number, speed?: number }`（デフォルト `format: "png"`）。 |
| `toDataURL(type?, quality?)` | `"image/png"`, `"image/jpeg"`, `"image/webp"`, `"image/avif"` の Data URL 文字列を返します。 |
| `toConverter(converterInst)` | 現在の描画内容を既存の `ImageConverterInstance` へコピーします。 |
| `dispose()` / `[Symbol.dispose]()` | Wasm 側の `CanvasInstance` メモリを解放します。 |

### `CanvasRenderingContext2D` 対応機能

* **状態・変換・クリップ**: `save()`, `restore()`, `translate()`, `scale()`, `rotate()`, `transform()`, `setTransform()`, `resetTransform()`, `clip()`
* **矩形**: `fillRect()`, `strokeRect()`, `clearRect()`
* **パス**: `beginPath()`, `closePath()`, `moveTo()`, `lineTo()`, `quadraticCurveTo()`, `bezierCurveTo()`, `arc()`, `arcTo()`, `ellipse()`, `rect()`, `roundRect()`, `fill()`, `stroke()`
* **スタイル**: `fillStyle` / `strokeStyle`（CSS カラー文字列・`CanvasGradient`）、`createLinearGradient()`, `createRadialGradient()`, `createConicGradient()`, `lineWidth`, `lineCap`, `lineJoin`, `miterLimit`, `setLineDash()`, `getLineDash()`, `lineDashOffset`
* **合成・効果**: `globalAlpha`, `globalCompositeOperation`（`source-over`, `multiply`, `screen`, `overlay` 等 26 種）, `shadowColor`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `filter`（`blur()`, `brightness()`, `contrast()`, `grayscale()`, `sepia()`, `hue-rotate()`, `invert()`, `opacity()`, `drop-shadow()`）
* **画像・ピクセル操作**: `drawImage()`（`Uint8Array` / `ArrayBuffer` / `Canvas` / `{ converterInst, frameIndex? }` に対応）、`imageSmoothingEnabled`, `imageSmoothingQuality`, `createImageData()`, `getImageData()`, `putImageData()`

### `CanvasPath2D`

`new CanvasPath2D(path?)` に SVG パス文字列（例: `"M 0 0 L 100 100 Z"`）または既存の `CanvasPath2D` を渡してパスを再利用できます。`fill(path)`, `stroke(path)`, `clip(path)` に渡せます。

---

## 3. HTML 内 `<canvas>` との連携 (`javascript: { canvas: true }`)

`render()` の `javascript` オプションに `{ canvas: true }` を渡すと、ページ内スクリプトの `canvas.getContext("2d")` や `OffscreenCanvas`・`Path2D` が Skia 2D Canvas エンジンへ接続され、描画結果が自動的に最終出力画像へ反映されます。

```typescript
import { render } from "wasm-html-to-image";

const result = await render({
  value: `
    <canvas id="c" width="200" height="120"></canvas>
    <script>
      const ctx = document.getElementById("c").getContext("2d");
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(10, 10, 180, 100);
    </script>
  `,
  width: 240,
  format: "png",
  javascript: { canvas: true },
});
```

`createDOM()` を手動で使う場合は、`beforeStart` フック内で `installCanvasBridge(page.dom, mod)` を呼び出します（終了時に `bridge.dispose()` を呼んでください）。

---

## 4. 現在の制限事項

* **テキスト描画 (`fillText` / `strokeText` / `measureText`)**: 未実装です。テキストを描画したい場合は `htmlToImage()` で HTML をレンダリングし、`ctx.drawImage()` で Canvas に合成してください。
* **パターン (`createPattern`)**: 未実装です。
* **SVG / PDF 出力**: `canvas.encode({ format: "svg" })` および `"pdf"` は、ラスタ描画されたビットマップを 1 枚の画像として埋め込んだ SVG / PDF になります（ベクターパス維持ではありません）。
