import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startCdpServer } from "wasm-html-to-image-cdp";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "output");

async function main() {
  await mkdir(outDir, { recursive: true });

  // Sample target web app
  const appServer = createServer((req, res) => {
    if (req.url === "/next") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`
        <!doctype html>
        <html>
          <head><title>Second Page</title></head>
          <body style="margin: 0; padding: 32px; background: #1e293b; color: #f8fafc; font-family: sans-serif;">
            <h1>Arrived at /next</h1>
            <p id="status">Navigated via link click!</p>
          </body>
        </html>
      `);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`
      <!doctype html>
      <html>
        <head><title>Start Page</title></head>
        <body style="margin: 0; padding: 32px; background: #0f172a; color: #f8fafc; font-family: sans-serif;">
          <h1>Start Page</h1>
          <a id="next-link" href="/next" style="display: inline-block; padding: 10px 18px; background: #10b981; color: white; text-decoration: none; border-radius: 6px;">
            Go to /next
          </a>
        </body>
      </html>
    `);
  });
  await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  const appPort = (appServer.address() as AddressInfo).port;

  // Start a WebSocket CDP server (like Cloudflare Kitesurf's CDP endpoint)
  const cdpServer = await startCdpServer();
  console.log("CDP WebSocket endpoint:", cdpServer.wsUrl);

  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: cdpServer.wsUrl,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 640, height: 360 });
      await page.goto(`http://127.0.0.1:${appPort}/`);
      console.log("Loaded title:", await page.title());

      await Promise.all([page.waitForNavigation(), page.click("#next-link")]);
      console.log("Navigated URL:", page.url());
      console.log("Navigated title:", await page.title());

      const png = await page.screenshot({ type: "png" });
      await writeFile(join(outDir, "ws-screenshot.png"), png);
      console.log("Saved:", join(outDir, "ws-screenshot.png"), `(${png.byteLength} bytes)`);
    } finally {
      await browser.close();
    }
  } finally {
    await cdpServer.close();
    appServer.closeAllConnections?.();
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
