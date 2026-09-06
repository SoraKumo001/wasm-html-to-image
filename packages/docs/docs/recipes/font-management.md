---
sidebar_position: 6
title: 高度なフォント管理と事前ロード
---

# 高度なフォント管理と事前ロード

テキストの豆腐化（文字化け）を防ぎ、レンダリング時間を最小化するためのフォント管理手法です。

## 1. Google Fonts のキャッシュを活用

`wasm-html-to-image` は取得したフォントをプロセス内メモリに自動キャッシュします。サーバー起動時にダミー描画を行うことで、初回リクエストの遅延を解消（ウォームアップ）できます。

```typescript
import { render } from "wasm-html-to-image/single";

// サーバー起動時のウォームアップ
export async function warmupFonts() {
  await render({
    value: `<div style="font-family: 'Noto Sans JP', sans-serif;">ウォームアップ</div>`,
    width: 100,
    format: "png",
  });
}
```

---

## 2. 独自フォントの完全内包 (オフライン・高速描画)

フォントファイルをローカルから直接読み込んで `fallbackFonts` に渡すことで、外部ネットワーク通信をゼロに抑えることができます。

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const notoSansJP = await fs.readFile("./fonts/NotoSansJP-Bold.ttf");

export async function generateBanner(title: string) {
  return await render({
    value: `<h1>${title}</h1>`,
    width: 800,
    format: "webp",
    fallbackFonts: [notoSansJP],
  });
}
```
