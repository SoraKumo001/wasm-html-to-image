import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { createCdpTransport } from "../src/index.js";

describe("CDP Phase 1: connect, newPage, setContent, goto, evaluate", () => {
  it("connects via puppeteer-core, runs setContent and evaluate", async () => {
    const unhandled: string[] = [];
    const transport = createCdpTransport({
      onUnhandledMethod: (method) => unhandled.push(method),
    });

    const browser = await puppeteer.connect({ transport });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<h1 id="title">Hello CDP</h1><script>window.answer = 40 + 2;</script>`,
      );

      const res = await page.evaluate(() => {
        return {
          text: document.querySelector("#title")?.textContent,
          answer: (window as unknown as { answer: number }).answer,
        };
      });

      expect(res).toEqual({ text: "Hello CDP", answer: 42 });
    } finally {
      await browser.close();
    }
    if (unhandled.length > 0) {
      console.log("Unhandled CDP methods (setContent):", unhandled);
    }
  });

  it("navigates to a local HTTP URL and evaluates DOM", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><title>Test Page</title></head><body><p>Loaded</p><script>document.body.setAttribute("data-ok", "1");</script></body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const browser = await puppeteer.connect({ transport: createCdpTransport() });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const title = await page.title();
      const attr = await page.evaluate(() => document.body.getAttribute("data-ok"));
      expect(title).toBe("Test Page");
      expect(attr).toBe("1");
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
