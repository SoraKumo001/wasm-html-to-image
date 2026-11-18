---
sidebar_position: 8
title: Puppeteer (CDP) Integration
---

# Puppeteer (CDP) Integration

With **wasm-html-to-image-cdp**, you can drive `wasm-html-to-image` and `wasm-quickjs-dom` directly from `puppeteer-core` via the Chrome DevTools Protocol (CDP) without launching Chromium.

## Key Features

- **No Chromium Required**: Combines the QuickJS-ng WebAssembly DOM, `enableLiveLayout`, and Skia-based rendering.
- **Two Connection Modes**:
  - **In-Process Transport (`createCdpTransport`)**: Connect directly via `puppeteer.connect({ transport })` with no socket overhead.
  - **WebSocket CDP Server (`startCdpServer`)**: Expose a `ws://.../devtools/browser` endpoint (`browserWSEndpoint`) and `/json/version` (`browserURL`).
- **Interactive Automation & Output**: Supports `goto()`, `setContent()`, `evaluate()`, `click()`, `type()`, `waitForSelector()`, `waitForNavigation()` (`<a href>` clicks and `location.href`), `CookieJar` persistence, `screenshot()` (PNG/JPEG/WebP), and `pdf()`.

## In-Process Transport Example

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

## WebSocket CDP Server Example

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

## Limitations

- `<canvas>` 2D/WebGL scripting and nested `<iframe>` browsing contexts are not supported.
- See `examples/puppeteer-cdp/` in the repository for runnable examples.
