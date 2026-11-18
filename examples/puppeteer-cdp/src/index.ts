import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createCdpTransport } from "wasm-html-to-image-cdp";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "output");

async function main() {
  await mkdir(outDir, { recursive: true });

  // Connect puppeteer-core directly in-process (no Chromium binary required)
  const browser = await puppeteer.connect({
    transport: createCdpTransport(),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });

    await page.setContent(`
      <!doctype html>
      <html>
        <body style="margin: 0; padding: 32px; background: #0f172a; color: #f8fafc; font-family: sans-serif;">
          <h1 style="margin: 0 0 16px; font-size: 24px;">wasm-html-to-image + Puppeteer</h1>
          <div style="display: flex; gap: 12px; align-items: center;">
            <input id="name" type="text" placeholder="Your name" style="width: 220px; height: 36px; padding: 0 10px; font-size: 16px;" />
            <button id="apply" style="height: 36px; padding: 0 16px; background: #6366f1; color: white; border: none; border-radius: 6px; font-size: 15px;">
              Greet
            </button>
          </div>
          <p id="greeting" style="margin-top: 20px; font-size: 20px; color: #38bdf8;">Waiting...</p>
          <script>
            document.getElementById("apply").addEventListener("click", () => {
              const name = document.getElementById("name").value || "World";
              document.getElementById("greeting").textContent = "Hello, " + name + "!";
            });
          </script>
        </body>
      </html>
    `);

    await page.click("#name");
    await page.type("#name", "Kitesurf");
    await page.click("#apply");

    const greeting = await page.$eval("#greeting", (el) => el.textContent);
    console.log("Greeting text:", greeting);

    const png = await page.screenshot({ type: "png" });
    await writeFile(join(outDir, "screenshot.png"), png);
    console.log("Saved:", join(outDir, "screenshot.png"), `(${png.byteLength} bytes)`);

    const pdf = await page.pdf();
    await writeFile(join(outDir, "page.pdf"), pdf);
    console.log("Saved:", join(outDir, "page.pdf"), `(${pdf.byteLength} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
