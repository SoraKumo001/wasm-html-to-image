import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { createCdpTransport, startCdpServer } from "../src/index.js";

describe("CDP Phase 4: link/location navigation, cookies, and WebSocket server", () => {
  it("navigates via <a href> click and location.href while preserving cookies", async () => {
    const appServer = createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "sid=abc123; Path=/",
        });
        res.end(`
          <!doctype html>
          <html>
            <head><title>Home</title></head>
            <body>
              <a id="go" href="/next" style="display: inline-block; width: 120px; height: 40px;">Next Page</a>
            </body>
          </html>
        `);
        return;
      }
      if (req.url === "/next") {
        const cookie = req.headers.cookie ?? "";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`
          <!doctype html>
          <html>
            <head><title>Next</title></head>
            <body><p id="cookie">${cookie}</p></body>
          </html>
        `);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>End</title></head><body><h1>Done</h1></body></html>`);
    });
    await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
    const port = (appServer.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const browser = await puppeteer.connect({ transport: createCdpTransport() });
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/`);
      expect(await page.title()).toBe("Home");

      await Promise.all([
        page.waitForNavigation(),
        page.click("#go"),
      ]);
      expect(page.url()).toBe(`${base}/next`);
      expect(await page.title()).toBe("Next");
      expect(await page.$eval("#cookie", (el) => el.textContent)).toContain("sid=abc123");

      await Promise.all([
        page.waitForNavigation(),
        page.evaluate(() => {
          window.location.href = "/end";
        }),
      ]);
      expect(page.url()).toBe(`${base}/end`);
      expect(await page.title()).toBe("End");
    } finally {
      await browser.close();
      appServer.closeAllConnections?.();
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
    }
  });

  it("connects via browserWSEndpoint (WebSocket CDP server)", async () => {
    const appServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>WS Page</title></head><body><h1 id="h">Over WS</h1></body></html>`);
    });
    await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
    const appPort = (appServer.address() as AddressInfo).port;

    const cdpServer = await startCdpServer();
    try {
      const browser = await puppeteer.connect({ browserWSEndpoint: cdpServer.wsUrl });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${appPort}/`);
        expect(await page.title()).toBe("WS Page");
        expect(await page.$eval("#h", (el) => el.textContent)).toBe("Over WS");
        const png = await page.screenshot({ type: "png" });
        expect(png[0]).toBe(0x89);
      } finally {
        await browser.close();
      }
    } finally {
      await cdpServer.close();
      appServer.closeAllConnections?.();
      await new Promise<void>((resolve) => appServer.close(() => resolve()));
    }
  });
});
