---
sidebar_position: 5
title: 画像変換・最適化 & ThumbHash
---

# 画像変換・最適化 & ThumbHash

`wasm-html-to-image` は HTML レンダリングだけでなく、既存の画像バイナリを直接受け取ってリサイズ、フォーマット変換、WebP/AVIF 圧縮、ThumbHash 生成を行う高速画像エンジンとしても動作します。

## 画像のリサイズと WebP 変換

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const inputImage = await fs.readFile("original.jpg");

// 幅 800px にリサイズし、WebP に変換
const webp = await render({
  value: inputImage,
  width: 800,
  format: "webp",
  quality: 80,
  fit: "contain",
});

await fs.writeFile("optimized.webp", Buffer.from(webp));
```

---

## プレースホルダー用 ThumbHash の生成

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

## 画像から SVG への変換

入力画像を PNG data URL でラップした SVG を一瞬で生成します。

```typescript
const svgString = await render({
  value: inputImage,
  width: 600,
  format: "svg",
});

console.log(svgString); // <svg ...><image href="data:image/png;base64,..." /></svg>
```
