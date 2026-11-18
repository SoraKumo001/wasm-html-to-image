import puppeteer from "puppeteer-core";
import { describe, expect, it } from "vitest";
import { createCdpTransport } from "../src/index.js";

describe("CDP Phase 3: click, type, waitForSelector, $eval", () => {
  it("clicks button, types into input, and waits for dynamically added selector", async () => {
    const unhandled: string[] = [];
    const browser = await puppeteer.connect({
      transport: createCdpTransport({
        onUnhandledMethod: (m) => unhandled.push(m),
      }),
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 600, height: 400 });
      await page.setContent(`
        <div style="padding: 20px;">
          <input id="name" type="text" style="display: block; width: 200px; height: 32px;" />
          <button id="btn" style="display: block; width: 120px; height: 40px; margin-top: 12px;">Submit</button>
          <div id="out"></div>
        </div>
        <script>
          document.getElementById("btn").addEventListener("click", () => {
            const val = document.getElementById("name").value;
            document.getElementById("out").textContent = "Hello, " + val;
            setTimeout(() => {
              const badge = document.createElement("span");
              badge.id = "done";
              badge.textContent = "OK";
              document.body.appendChild(badge);
            }, 30);
          });
        </script>
      `);

      await page.click("#name");
      await page.type("#name", "Kitesurf");
      await page.click("#btn");

      const text = await page.$eval("#out", (el) => el.textContent);
      expect(text).toBe("Hello, Kitesurf");

      const done = await page.waitForSelector("#done");
      expect(await done?.evaluate((el) => el.textContent)).toBe("OK");
    } finally {
      await browser.close();
    }

    expect(unhandled).toEqual([]);
  });
});
