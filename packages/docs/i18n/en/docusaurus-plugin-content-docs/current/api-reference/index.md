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
| `wasm-html-to-image/edge-light` | `render(options)`                                         | Vercel Edge Runtime binding                            |
| `wasm-html-to-image/workers`    | `createHtmlToImageWorker()`<br/>`render(options)`         | Multi-threaded worker pool                             |
| `wasm-html-to-image/react`      | `render(options)`                                         | Wrapper for React JSX elements                         |
| `wasm-html-to-image/preact`     | `render(options)`                                         | Wrapper for Preact JSX elements                        |
| `wasm-html-to-image/tailwind`   | `inlineTailwind(html)`                                    | Inlines Tailwind utility classes                       |
