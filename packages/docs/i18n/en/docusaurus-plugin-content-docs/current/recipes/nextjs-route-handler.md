---
sidebar_position: 3
title: Next.js App Router (Route Handler)
---

# Next.js App Router (Route Handler)

Dynamically serve images directly from Next.js App Router handlers (`app/api/og/route.ts`).

```typescript
// app/api/og/route.ts
import { NextRequest } from "next/server";
import { render } from "wasm-html-to-image/single";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") || "Next.js Blog";

  const png = await render({
    value: `<div style="width: 1200px; height: 630px; padding: 50px; background: #18181b; color: white; display: flex; align-items: center;">
      <h1 style="font-size: 60px;">${title}</h1>
    </div>`,
    width: 1200,
    height: 630,
    format: "png",
  });

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```
