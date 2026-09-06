---
sidebar_position: 1
title: Production OGP Image Service
---

# Production OGP Image Service

Building an automated Open Graph Image generator with custom HTML/CSS layouts.

```typescript
import { Hono } from "hono";
import { render } from "wasm-html-to-image/single";

const app = new Hono();

app.get("/ogp", async (c) => {
  const title = c.req.query("title") || "No Title";

  const html = `
    <div style="
      width: 1200px;
      height: 630px;
      padding: 60px;
      background: #0f172a;
      color: white;
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: center;
    ">
      <h1 style="font-size: 56px; font-weight: 800;">${title}</h1>
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
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export default app;
```
