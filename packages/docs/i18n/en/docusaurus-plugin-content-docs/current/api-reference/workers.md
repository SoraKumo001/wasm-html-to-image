---
sidebar_position: 5
title: Parallel Workers
---

# Parallel Workers

`wasm-html-to-image/workers` distributes rendering tasks across Node.js worker threads or browser Web Workers to maximize throughput on multi-core systems.

## Usage

```typescript
import { render } from "wasm-html-to-image/workers";

// Concurrently render multiple requests
const tasks = Array.from({ length: 8 }, (_, i) =>
  render({
    value: `<h1>Card #${i + 1}</h1>`,
    width: 600,
    height: 400,
    format: "webp",
  }),
);

const results = await Promise.all(tasks);
```
