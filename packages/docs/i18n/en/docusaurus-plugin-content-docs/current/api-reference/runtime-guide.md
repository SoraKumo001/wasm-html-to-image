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

No `rules` are needed in `wrangler.jsonc` on current Wrangler (v3/v4):
`import ... from "*.wasm"` is bundled as `WebAssembly.Module` by default.
A minimal config is sufficient:

```jsonc
{
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
}
```

> Compatibility note: writing `rules` yourself overrides the defaults, so only keep `rules: [{ "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": false }]` if you customize bundling rules or use a very old Wrangler. `rules` are ignored by `@cloudflare/vite-plugin`.

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

`edge-light` bundles no default wasm: pass a caller-supplied `WebAssembly.Module` as the 2nd argument of `render(options, wasm)`.

```typescript
import { render } from "wasm-html-to-image/edge-light";

export const runtime = "edge";

export async function GET(request: Request) {
  const wasm = await WebAssembly.compile(
    await (await fetch(wasmUrl)).arrayBuffer(),
  );

  const webp = await render(
    {
      value: "<h1>Edge Runtime OGP</h1>",
      width: 1200,
      height: 630,
      format: "webp",
    },
    wasm,
  );

  return new Response(webp, {
    headers: { "Content-Type": "image/webp" },
  });
}
```
