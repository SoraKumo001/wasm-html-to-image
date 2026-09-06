---
sidebar_position: 3
title: ランタイム別ガイド
---

# ランタイム別ガイド

各プラットフォーム・実行環境ごとのセットアップと最適な利用方法を解説します。

## 1. Node.js

Node.js 環境ではすべてのサブパスが利用可能です。

### 単発・シンプル処理

```typescript
import { render } from "wasm-html-to-image/single";

const png = await render({
  value: "<h1>Hello Node.js</h1>",
  width: 800,
  format: "png",
});
```

### サーバー立ち上げ時のインスタンス再利用

```typescript
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image";

// サーバー起動時に一度だけロード
const mod = await loadHtmlToImageModule();

// 各リクエストハンドラ内で再利用
app.get("/ogp", async (req, res) => {
  const image = await htmlToImage(mod, {
    value: `<h1>${req.query.title}</h1>`,
    width: 1200,
    height: 630,
    format: "webp",
  });
  res.type("image/webp").send(Buffer.from(image));
});
```

---

## 2. Cloudflare Workers (`workerd`)

Cloudflare Workers では、`wasm-html-to-image/workerd` を使用します。

### wrangler.jsonc 設定

Miniflare / Wrangler が `.wasm` ファイルを正しく WebAssembly.Module としてバンドルできるように設定します。

```jsonc
{
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "rules": [
    {
      "type": "CompiledWasm",
      "globs": ["**/*.wasm"],
      "fallthrough": false,
    },
  ],
}
```

### Worker コード

```typescript
import { render } from "wasm-html-to-image/workerd";

export default {
  async fetch(request: Request): Promise<Response> {
    const png = await render({
      value: `<div style="padding: 20px; font-family: sans-serif;">
        <h2>Cloudflare Workers OGP</h2>
      </div>`,
      width: 1200,
      height: 630,
      format: "png",
    });

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
```

---

## 3. Vercel Edge Runtime (`edge-light`)

Vercel Edge Functions や Next.js の `runtime = "edge"` では、`wasm-html-to-image/edge-light` を使用します。

```typescript
import { render } from "wasm-html-to-image/edge-light";

export const runtime = "edge";

export async function GET(request: Request) {
  const webp = await render({
    value: "<h1>Edge Runtime OGP</h1>",
    width: 1200,
    height: 630,
    format: "webp",
  });

  return new Response(webp, {
    headers: { "Content-Type": "image/webp" },
  });
}
```

---

## 4. モダンブラウザ

ブラウザでは、メインスレッドでの直接実行または Web Worker 経由での並列実行が可能です。

```typescript
import { render } from "wasm-html-to-image/single";

const pngBuffer = await render({
  value: "<h1>Browser Client-side Rendering</h1>",
  width: 600,
  format: "png",
});

const blob = new Blob([pngBuffer], { type: "image/png" });
const imgUrl = URL.createObjectURL(blob);
document.querySelector("img")!.src = imgUrl;
```
