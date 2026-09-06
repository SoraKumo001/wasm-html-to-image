---
sidebar_position: 7
title: Batch Generation with Worker Pool
---

# Batch Generation with Worker Pool

Mass generation of hundreds or thousands of banners using multi-core worker threads.

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { render } from "wasm-html-to-image/workers";

const items = Array.from({ length: 50 }, (_, i) => ({
  id: `card-${i + 1}`,
  title: `Item #${i + 1}`,
}));

async function runBatch() {
  await Promise.all(
    items.map(async (item) => {
      const webp = await render({
        value: `<h1>${item.title}</h1>`,
        width: 600,
        height: 400,
        format: "webp",
      });

      await fs.writeFile(`./dist/${item.id}.webp`, Buffer.from(webp));
    }),
  );
}

runBatch();
```
