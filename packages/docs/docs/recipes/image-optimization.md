---
sidebar_position: 5
title: 画像相互変換・最適化 & ThumbHash
---

# 画像相互変換・最適化 & ThumbHash

`wasm-html-to-image` は HTML レンダリングだけでなく、既存の画像バイナリを直接受け取ってリサイズ、フォーマット変換、WebP/AVIF 圧縮、ThumbHash 生成を行う高速画像エンジンとしても動作します。

外部の重い画像処理ライブラリ（Sharp や ImageMagick 等）を追加することなく、単一のライブラリで画像処理タスクを完結できます。

---

## 1. 対応フォーマットと変換対応表

入力された画像バイト列（`Uint8Array` または `Buffer`）はマジックバイトによって自動識別されます。

| 入力形式 (自動判別)          | 変換可能な出力フォーマット                                      |
| ---------------------------- | --------------------------------------------------------------- |
| **PNG**                      | `webp`, `avif`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **JPEG**                     | `webp`, `avif`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **WebP**                     | `avif`, `webp`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |
| **GIF** (アニメーション含む) | `webp` (アニメーション保持可), `png`, `jpeg`, `avif`, etc.      |
| **AVIF**                     | `webp`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf`         |
| **BMP**                      | `webp`, `avif`, `jpeg`, `png`, `raw`, `thumbhash`, `svg`, `pdf` |

---

## 2. 実践的な変換コード例

### A. JPEG/PNG から WebP / AVIF への変換・圧縮

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const inputImage = await fs.readFile("photo.jpg");

// JPEG を WebP (品質 80) に変換
const webp = await render({
  value: inputImage,
  width: 800,
  format: "webp",
  quality: 80,
  fit: "contain",
});
await fs.writeFile("photo.webp", Buffer.from(webp));

// JPEG を AVIF (最高圧縮率) に変換
const avif = await render({
  value: inputImage,
  width: 800,
  format: "avif",
  quality: 75,
  speed: 6, // 0(最高品質・低速) 〜 10(高速)
});
await fs.writeFile("photo.avif", Buffer.from(avif));
```

---

### B. 切り抜き (Crop) とリサイズ

指定した領域をクロップしてから目的のフォーマットに出力します。

```typescript
// 座標 (x: 100, y: 100) から 幅 400x400 を切り抜き、PNG で出力
const cropped = await render({
  value: inputImage,
  crop: { x: 100, y: 100, width: 400, height: 400 },
  width: 200, // さらに 200x200 に縮小
  height: 200,
  format: "png",
});
```

---

### C. アニメーション GIF を アニメーション WebP に変換

`animation: true` を指定することで、全フレームを保持したアニメーション WebP を出力できます。

```typescript
const gifData = await fs.readFile("animation.gif");

const animatedWebp = await render({
  value: gifData,
  format: "webp",
  quality: 75,
  animation: true, // アニメーションフレームを保持
});

await fs.writeFile("animation.webp", Buffer.from(animatedWebp));
```

---

### D. プレースホルダー用 ThumbHash の生成

画像の読み込み中に表示する低解像度プレースホルダー用の ThumbHash ハッシュを直接算出できます。

```typescript
const thumbhashBytes = await render({
  value: inputImage,
  width: 100,
  format: "thumbhash",
});

console.log("ThumbHash bytes:", thumbhashBytes);
```

---

### E. 画像から SVG / PDF への変換

- **SVG 化**: 入力画像を PNG data URL でラップした `<image>` タグを含む SVG を即座に生成。
- **PDF 化**: 入力画像を 1 ページ等倍で配置したベクター PDF を生成。

```typescript
// SVG 出力 (戻り値は string)
const svgString = await render({
  value: inputImage,
  width: 600,
  format: "svg",
});

// PDF 出力 (戻り値は Uint8Array)
const pdfBuffer = await render({
  value: inputImage,
  format: "pdf",
});
```
