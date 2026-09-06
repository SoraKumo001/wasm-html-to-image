---
sidebar_position: 1
title: 本番 OGP 画像生成サービス
---

# 本番 OGP 画像生成サービス

SNS 共有（Twitter Card、Open Graph）用の動的画像を生成する実装例です。

## 実装例 (Hono / Node.js)

```typescript
import { Hono } from "hono";
import { render } from "wasm-html-to-image/single";

const app = new Hono();

app.get("/ogp", async (c) => {
  const title = c.req.query("title") || "No Title";
  const author = c.req.query("author") || "Anonymous";

  const html = `
    <div style="
      width: 1200px;
      height: 630px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 60px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      box-sizing: border-box;
      font-family: 'Inter', sans-serif;
      color: white;
    ">
      <div style="font-size: 24px; color: #38bdf8; font-weight: 600;">
        MY SERVICE BLOG
      </div>
      
      <div style="font-size: 56px; font-weight: 800; line-height: 1.25;">
        ${title}
      </div>

      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="font-size: 24px; color: #94a3b8;">
          Written by <strong style="color: white;">${author}</strong>
        </div>
      </div>
    </div>
  `;

  const image = await render({
    value: html,
    width: 1200,
    height: 630,
    format: "png",
  });

  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
});

export default app;
```
