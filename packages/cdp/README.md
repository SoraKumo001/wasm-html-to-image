# wasm-html-to-image-cdp

A lightweight **Chrome DevTools Protocol (CDP)** adapter for `wasm-quickjs-dom` and `wasm-html-to-image`, enabling `puppeteer-core` to drive pages, run JavaScript, interact with elements, and capture screenshots or PDFs **without launching Chromium**.

## Features

- **In-Process Transport (`createCdpTransport`)**: Connect `puppeteer.connect({ transport })` directly in the same process with zero WebSocket overhead.
- **WebSocket CDP Server (`startCdpServer`)**: Expose a `/devtools/browser` WebSocket endpoint and `/json/version` metadata endpoint for `puppeteer.connect({ browserWSEndpoint })` or `browserURL`.
- **DOM & Script Execution**: Powered by `wasm-quickjs-dom` (QuickJS-ng + native C DOM + `CookieJar`) with `RemoteObject` tracking (`objectId` / `backendNodeId`), `Runtime.addBinding`, and a background timer pump.
- **Live Layout & Interactions**: Uses `enableLiveLayout` so `page.click()`, `page.type()`, `page.waitForSelector()`, and `page.$eval()` work against real computed layout boxes.
- **Screenshots & PDFs**: Uses `wasm-html-to-image` (Skia + HarfBuzz) for `page.screenshot()` (PNG, JPEG, WebP) and `page.pdf()` (via CDP `IO` stream).
- **Navigation & Cookies**: Supports `page.goto()`, `page.setContent()`, `page.reload()`, `<a href>` click navigation, and `location.href` / `location.assign()` / `location.replace()` with `waitForNavigation()`.

## Usage

### 1. In-Process Transport

```ts
import puppeteer from "puppeteer-core";
import { createCdpTransport } from "wasm-html-to-image-cdp";

const browser = await puppeteer.connect({
  transport: createCdpTransport(),
});

const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.setContent(`<h1>Hello CDP</h1><button id="btn">Go</button>`);
const png = await page.screenshot({ type: "png" });

await browser.close();
```

### 2. WebSocket CDP Server

```ts
import puppeteer from "puppeteer-core";
import { startCdpServer } from "wasm-html-to-image-cdp";

const server = await startCdpServer({ port: 9222 });
const browser = await puppeteer.connect({
  browserWSEndpoint: server.wsUrl,
});

const page = await browser.newPage();
await page.goto("https://example.com/");
const title = await page.title();

await browser.close();
await server.close();
```

## Supported CDP Domains

- **Browser / Target**: `Browser.getVersion`, `Browser.close`, `Target.getBrowserContexts`, `Target.createBrowserContext`, `Target.disposeBrowserContext`, `Target.setDiscoverTargets`, `Target.setAutoAttach`, `Target.getTargets`, `Target.createTarget`, `Target.attachToTarget`, `Target.closeTarget`
- **Page**: `Page.enable`, `Page.disable`, `Page.setLifecycleEventsEnabled`, `Page.getFrameTree`, `Page.createIsolatedWorld`, `Page.addScriptToEvaluateOnNewDocument`, `Page.removeScriptToEvaluateOnNewDocument`, `Page.navigate`, `Page.setDocumentContent`, `Page.reload`, `Page.getNavigationHistory`, `Page.getLayoutMetrics`, `Page.captureScreenshot`, `Page.printToPDF`
- **Runtime**: `Runtime.enable`, `Runtime.disable`, `Runtime.runIfWaitingForDebugger`, `Runtime.evaluate`, `Runtime.callFunctionOn`, `Runtime.getProperties`, `Runtime.releaseObject`, `Runtime.releaseObjectGroup`, `Runtime.addBinding`, `Runtime.removeBinding`
- **DOM / Input / Emulation / IO**: `DOM.describeNode`, `DOM.resolveNode`, `DOM.getContentQuads`, `DOM.getBoxModel`, `DOM.scrollIntoViewIfNeeded`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Emulation.setDeviceMetricsOverride`, `IO.read`, `IO.close`

## Limitations

- `<canvas>` 2D/WebGL scripting and nested `<iframe>` browsing contexts are not supported.
- Intended for lightweight automation, AI agents, scraping, and screenshot/PDF generation rather than full Chromium parity.
