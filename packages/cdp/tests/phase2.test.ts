import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { createCdpTransport } from "../src/index.js";

describe("CDP Phase 2: setViewport, screenshot, pdf", () => {
  it("captures PNG and WebP screenshots and generates PDF", async () => {
    const unhandled: string[] = [];
    const browser = await puppeteer.connect({
      transport: createCdpTransport({
        onUnhandledMethod: (m) => unhandled.push(m),
      }),
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 400, height: 300 });
      await page.setContent(`
        <div style="width: 100%; height: 100%; background: #0f172a; color: white; padding: 24px; font-family: sans-serif;">
          <h1>Puppeteer + wasm-html-to-image</h1>
          <p id="msg">Initial</p>
        </div>
      `);

      await page.evaluate(() => {
        const el = document.querySelector("#msg");
        if (el) el.textContent = "Updated via Puppeteer";
      });

      const png = await page.screenshot({ type: "png" });
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
      expect(png[2]).toBe(0x4e);
      expect(png[3]).toBe(0x47);
      expect(png.byteLength).toBeGreaterThan(200);

      const webp = await page.screenshot({ type: "webp", quality: 80 });
      expect(Buffer.from(webp.subarray(0, 4)).toString("ascii")).toBe("RIFF");
      expect(Buffer.from(webp.subarray(8, 12)).toString("ascii")).toBe("WEBP");

      const pdf = await page.pdf();
      expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    } finally {
      await browser.close();
    }

    expect(unhandled).toEqual([]);
  });
});
