---
sidebar_position: 2
title: Cloudflare Edge Caching
---

# Cloudflare Edge Caching

Combine Cloudflare Workers with Cache API to cache rendered images globally.

```typescript
import { render } from "wasm-html-to-image/workerd";

export default {
  async fetch(
    request: Request,
    env: any,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);

    // 1. Check edge cache
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const title = new URL(request.url).searchParams.get("title") || "Title";

    // 2. Render image
    const image = await render({
      value: `<h1>${title}</h1>`,
      width: 1200,
      height: 630,
      format: "webp",
    });

    const response = new Response(image, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=604800",
      },
    });

    // 3. Store response asynchronously
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
```
