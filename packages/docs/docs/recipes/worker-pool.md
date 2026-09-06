---
sidebar_position: 7
title: Worker プールによる大量一括生成
---

# Worker プールによる大量一括生成

何百枚、何千枚もの画像を短時間で生成する場合、`wasm-html-to-image/workers` を用いて CPU コア数に応じた並列処理を行うのが最適です。

## 実装例: バッチ画像生成スクリプト

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { render } from "wasm-html-to-image/workers";

interface Product {
  id: string;
  name: string;
  price: string;
}

const products: Product[] = [
  { id: "1", name: "Premium Coffee", price: "¥580" },
  { id: "2", name: "Matcha Latte", price: "¥620" },
  // ... 数百件のデータ
];

async function generateAllCards() {
  const outputDir = path.resolve("./dist-cards");
  await fs.mkdir(outputDir, { recursive: true });

  console.log(`Starting batch generation of ${products.length} cards...`);
  const startTime = Date.now();

  // ワーカープールへタスクを並列投入
  await Promise.all(
    products.map(async (item) => {
      const html = `
        <div style="width: 400px; height: 300px; padding: 24px; background: #fafafa; border: 2px solid #e4e4e7; border-radius: 12px; font-family: sans-serif;">
          <h2 style="margin: 0; color: #18181b;">${item.name}</h2>
          <p style="font-size: 24px; color: #16a34a; font-weight: bold;">${item.price}</p>
        </div>
      `;

      const { data } = await render({
        value: html,
        width: 400,
        height: 300,
        format: "webp",
        quality: 85,
      });

      await fs.writeFile(
        path.join(outputDir, `${item.id}.webp`),
        Buffer.from(data),
      );
    }),
  );

  console.log(`Completed in ${Date.now() - startTime} ms!`);
}

generateAllCards();
```
