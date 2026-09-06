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
import { render } from "wasm-html-to-image";

const { data } = await render({
  value: "<h1>Hello Node.js</h1>",
  width: 800,
  format: "png",
});
```

### サーバー立ち上げ時のインスタンス再利用

```typescript
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image/index";

// サーバー起動時に一度だけロード
const mod = await loadHtmlToImageModule();

// 各リクエストハンドラ内で再利用
app.get("/ogp", async (req, res) => {
  const result = await htmlToImage(mod, {
    value: `<h1>${req.query.title}</h1>`,
    width: 1200,
    height: 630,
    format: "webp",
  });
  res.type("image/webp").send(Buffer.from(result.data));
});
```

---

## 2. Cloudflare Workers (`workerd`)

Cloudflare Workers では、ルートの `wasm-html-to-image`（自動検出で `workerd` 実装がロードされます）または明示的な `wasm-html-to-image/workerd` を使用します。

### wrangler.jsonc 設定

現行の Wrangler（v3/v4）では `.wasm` の import はデフォルトで `WebAssembly.Module` としてバンドルされるため、`rules` の設定は不要です。最小構成は以下で可です。

```jsonc
{
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
}
```

> 後方互換メモ: `rules` を自前で書くとデフォルトを上書きします。バンドルルールをカスタマイズする場合や非常に古い Wrangler を使う場合のみ `rules: [{ "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": false }]` を維持してください。`@cloudflare/vite-plugin` では `rules` は無視されます。

### Worker コード

```typescript
import { render } from "wasm-html-to-image"; // Cloudflare Workers (workerd) 実装が自動選択されます

export default {
  async fetch(request: Request): Promise<Response> {
    const { data } = await render({
      value: `<div style="padding: 20px; font-family: sans-serif;">
        <h2>Cloudflare Workers OGP</h2>
      </div>`,
      width: 1200,
      height: 630,
      format: "png",
    });

    return new Response(data, {
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

Vercel Edge Functions や Next.js の `runtime = "edge"` では、`wasm-html-to-image/edge-light` を使用します。`edge-light` は WASM を内包しないため、`render(options, wasm)` の第2引数に呼び出し側で用意した `WebAssembly.Module` を渡す必要があります。

```typescript
import { render } from "wasm-html-to-image/edge-light";

export const runtime = "edge";

export async function GET(request: Request) {
  const wasm = await WebAssembly.compile(
    await (await fetch(wasmUrl)).arrayBuffer(),
  );

  const { data } = await render(
    {
      value: "<h1>Edge Runtime OGP</h1>",
      width: 1200,
      height: 630,
      format: "webp",
    },
    wasm,
  );

  return new Response(data, {
    headers: { "Content-Type": "image/webp" },
  });
}
```

---

## 4. モダンブラウザ

ブラウザでは、メインスレッドでの直接実行または Web Worker 経由での並列実行が可能です。

```typescript
import { render } from "wasm-html-to-image";

const result = await render({
  value: "<h1>Browser Client-side Rendering</h1>",
  width: 600,
  format: "png",
});

const blob = new Blob([result.data], { type: "image/png" });
const imgUrl = URL.createObjectURL(blob);
document.querySelector("img")!.src = imgUrl;
```
