---
sidebar_position: 3
title: Runtime Guide
---

# Runtime Guide

Setup and best practices across various runtime platforms.

## 1. Node.js

```typescript
import { render } from "wasm-html-to-image/single";

const png = await render({
  value: "<h1>Hello Node.js</h1>",
  width: 800,
  format: "png",
});
```

---

## 2. Cloudflare Workers (`workerd`)

In `wrangler.jsonc`, configure compiled WASM rules:

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

```typescript
import { render } from "wasm-html-to-image/workerd";

export default {
  async fetch(request: Request): Promise<Response> {
    const png = await render({
      value: "<h1>Cloudflare Workers OGP</h1>",
      width: 1200,
      height: 630,
      format: "png",
    });

    return new Response(png, {
      headers: { "Content-Type": "image/png" },
    });
  },
};
```

---

## 3. Vercel Edge Runtime (`edge-light`)

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
