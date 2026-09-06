---
sidebar_position: 2
title: Cloudflare Workers キャッシュ戦略
---

# Cloudflare Workers キャッシュ戦略

Cloudflare Workers 上で OGP 画像を生成する際、Cache API を活用することでエッジでの無駄な再生成を防ぎ、ミリ秒単位のレスポンスを実現できます。

## Cache API と組み合わせる例

```typescript
import { render } from "wasm-html-to-image"; // workerd 環境では自動的に Workers 最適化版が解決されます

export default {
  async fetch(
    request: Request,
    env: any,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);

    // 1. エッジキャッシュの確認
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    const url = new URL(request.url);
    const title = url.searchParams.get("title") || "Default Title";

    // 2. 画像の生成
    const { data } = await render({
      value: `<div style="font-family: sans-serif; padding: 40px; background: #111; color: #fff; height: 100%;">
        <h1>${title}</h1>
      </div>`,
      width: 1200,
      height: 630,
      format: "webp",
      quality: 85,
    });

    const response = new Response(data, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      },
    });

    // 3. バックグラウンドでエッジキャッシュに保存
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};
```
