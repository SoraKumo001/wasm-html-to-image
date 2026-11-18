---
sidebar_position: 8
title: Puppeteer (CDP) 連携
---

# Puppeteer (CDP) 連携

**wasm-html-to-image-cdp** パッケージを使うと、Chromium を起動せずに `puppeteer-core` から `wasm-html-to-image` と `wasm-quickjs-dom` を操作できます（Chrome DevTools Protocol ブリッジ）。

## 主な特徴

- **Chromium 不要**: QuickJS（WebAssembly）上の DOM と `enableLiveLayout`、Skia ベースの描画エンジンを組み合わせて動作します。
- **2 通りの接続方式**:
  - **インプロセス接続（`createCdpTransport`）**: `puppeteer.connect({ transport })` で同一プロセス内に直接接続。
  - **WebSocket サーバー（`startCdpServer`）**: `ws://.../devtools/browser`（`browserWSEndpoint`）および `/json/version`（`browserURL`）を公開。
- **操作・遷移・出力に対応**: `goto()` / `setContent()` / `evaluate()` / `click()` / `type()` / `waitForSelector()` / `waitForNavigation()` / `screenshot()`（PNG / JPEG / WebP）/ `pdf()` に対応し、ページ遷移時の `CookieJar` 引き継ぎも行います。

## インプロセス接続の例

```typescript
import puppeteer from "puppeteer-core";
import { createCdpTransport } from "wasm-html-to-image-cdp";

const browser = await puppeteer.connect({
  transport: createCdpTransport(),
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  await page.setContent(`
    <input id="name" type="text" style="width: 200px; height: 32px;" />
    <button id="apply" style="width: 100px; height: 32px;">Greet</button>
    <p id="out"></p>
    <script>
      document.getElementById("apply").addEventListener("click", () => {
        document.getElementById("out").textContent =
          "Hello, " + document.getElementById("name").value;
      });
    </script>
  `);

  await page.click("#name");
  await page.type("#name", "Kitesurf");
  await page.click("#apply");

  const png = await page.screenshot({ type: "png" });
  const pdf = await page.pdf();
} finally {
  await browser.close();
}
```

## WebSocket CDP サーバーの例

```typescript
import puppeteer from "puppeteer-core";
import { startCdpServer } from "wasm-html-to-image-cdp";

const server = await startCdpServer({ port: 9222 });

try {
  const browser = await puppeteer.connect({
    browserWSEndpoint: server.wsUrl,
  });
  const page = await browser.newPage();
  await page.goto("https://example.com/");
  const png = await page.screenshot({ type: "png" });
  await browser.close();
} finally {
  await server.close();
}
```

## 制限事項

- `<canvas>` の 2D/WebGL スクリプティングやネストされた `<iframe>` コンテキストには対応していません。
- リポジトリ内の動作サンプルは `examples/puppeteer-cdp/` を参照してください。
