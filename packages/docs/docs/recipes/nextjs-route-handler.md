---
sidebar_position: 3
title: Next.js App Router (Route Handler)
---

# Next.js App Router (Route Handler)

Next.js App Router の Route Handler を使用して動的な画像を配信する実装パターンです。

Node.js ランタイムまたは Edge ランタイムのいずれでも利用可能です。

## Node.js ランタイムでの実装 (`single`)

```typescript
// app/api/og/route.ts
import { NextRequest } from "next/server";
import { render } from "wasm-html-to-image";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") || "Next.js Blog";

  const { data } = await render({
    value: `
      <div style="
        width: 1200px;
        height: 630px;
        padding: 50px;
        background: #09090b;
        color: #fafafa;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: center;
      ">
        <h1 style="font-size: 64px; font-weight: 700; margin: 0;">${title}</h1>
      </div>
    `,
    width: 1200,
    height: 630,
    format: "png",
  });

  return new Response(data, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

## Edge ランタイムでの実装 (`edge-light`)

```typescript
// app/api/og/route.ts
import { NextRequest } from "next/server";
import { render } from "wasm-html-to-image/edge-light";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { data } = await render({
    value: "<h1>Edge Runtime on Vercel</h1>",
    width: 1200,
    height: 630,
    format: "webp",
  });

  return new Response(data, {
    headers: { "Content-Type": "image/webp" },
  });
}
```
