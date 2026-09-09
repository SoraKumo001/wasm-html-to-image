---
sidebar_position: 1
title: API Overview
---

# API Overview

`wasm-html-to-image` provides versatile interfaces ranging from zero-config functions to low-level controls and parallel worker pools.

## Main Entry Points

| Path                            | Functions / Classes                                       | Use Case                                               |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `wasm-html-to-image/single`     | `render(options)`                                         | Embedded single WASM. Simplest zero-config entry point |
| `wasm-html-to-image`            | `loadHtmlToImageModule()`<br/>`htmlToImage(mod, options)` | High throughput via reusable module instance           |
| `wasm-html-to-image/workerd`    | `render(options)`                                         | Cloudflare Workers optimized binding                   |
| `wasm-html-to-image/edge-light` | `render(options, wasm)`                                   | Vercel Edge Runtime binding (caller supplies a pre-compiled `WebAssembly.Module` as 2nd arg) |
| `wasm-html-to-image/workers`    | `createHtmlToImageWorker()`<br/>`render(options)`         | Multi-threaded worker pool                             |
| `wasm-html-to-image/react`      | `render(options)`                                         | Wrapper for React JSX elements                         |
| `wasm-html-to-image/preact`     | `render(options)`                                         | Wrapper for Preact JSX elements                        |
| `wasm-html-to-image/tailwind`   | `inlineTailwind(html)`                                    | Inlines Tailwind utility classes                       |

---

## Basic Type Definitions

```typescript
export type ImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "avif"
  | "jxl"
  | "raw"
  | "thumbhash"
  | "svg"
  | "pdf";

export type RenderInput =
  | string // HTML string, URL, or Data URL
  | string[] // Array of HTML strings (for multi-page PDF)
  | Uint8Array // Image binary buffer
  | ArrayBuffer;

export interface RenderResult<T = Uint8Array | string> {
  data: T;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  format?: ImageFormat;
  isAnimated?: boolean;
}
```
