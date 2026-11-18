# Puppeteer CDP Example (`wasm-html-to-image-cdp`)

Chromium を使わずに、`puppeteer-core` から `wasm-html-to-image` + `wasm-quickjs-dom` を操作するサンプルです。

## 含まれるサンプル

1. **インプロセス接続 (`src/index.ts`)**
   `createCdpTransport()` を使って `puppeteer.connect({ transport })` で直接接続し、フォーム入力 (`click` / `type`)、DOM 更新、PNG スクリーンショット・PDF 生成を行います。
2. **WebSocket CDP サーバー経由 (`src/ws-example.ts`)**
   `startCdpServer()` で WebSocket CDP エンドポイント（`ws://127.0.0.1:<port>/devtools/browser`）を起動し、`puppeteer.connect({ browserWSEndpoint })` で接続してリンククリック遷移とスクリーンショット撮影を行います。

## 実行方法

```bash
# インプロセス接続サンプル
pnpm --filter example-puppeteer-cdp start

# WebSocket CDP サーバーサンプル
pnpm --filter example-puppeteer-cdp start:ws

# 型チェック
pnpm --filter example-puppeteer-cdp build
```

生成された画像は `output/` ディレクトリに出力されます。
