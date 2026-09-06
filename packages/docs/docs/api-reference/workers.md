---
sidebar_position: 5
title: 並列処理 (Workers)
---

# 並列処理 (Workers)

`wasm-html-to-image/workers` は、Node.js の `worker_threads` やブラウザの `Web Worker` を利用した並列ワーカープールを提供します。

WebAssembly の実行は CPU バウンドであるため、マルチコア環境において複数のワーカースレッドへ処理を分散させることで、スループットを劇的に向上させ、メインスレッドのイベントループの遅延を防ぐことができます。

```mermaid
flowchart LR
    App[メインスレッド / サーバー] --> Pool[Worker プール (wasm-html-to-image/workers)]
    Pool --> W1[Worker Thread 1 <br/> WASM インスタンス]
    Pool --> W2[Worker Thread 2 <br/> WASM インスタンス]
    Pool --> W3[Worker Thread 3 <br/> WASM インスタンス]
    Pool --> W4[Worker Thread 4 <br/> WASM インスタンス]
```

---

## 使い方

### 簡易レンダー

`wasm-html-to-image/workers` からエクスポートされる `render()` を直接呼び出すと、内部で管理される共有ワーカープールへタスクが自動的にディスパッチされます。

```typescript
import { render } from "wasm-html-to-image/workers";

// 複数のレンダリングリクエストを並列実行
const tasks = Array.from({ length: 10 }, (_, i) =>
  render({
    value: `<h1>Card #${i + 1}</h1>`,
    width: 600,
    height: 400,
    format: "webp",
  }),
);

const results = await Promise.all(tasks);
console.log(`Generated ${results.length} images in parallel.`);
```

---

## ワーカープールの明示的生成と管理

カスタムワーカー数やライフサイクルを制御したい場合は、`createHtmlToImageWorker` またはプール作成ヘルパーを利用します。

```typescript
import { createHtmlToImageWorker } from "wasm-html-to-image/workers";

// 4つのワーカーを持つインスタンスを作成
const worker = createHtmlToImageWorker();

const png = await worker.render({
  value: "<h1>High Throughput</h1>",
  width: 1200,
  format: "png",
});

// 不要になったらワーカーを終了
await worker.terminate();
```
