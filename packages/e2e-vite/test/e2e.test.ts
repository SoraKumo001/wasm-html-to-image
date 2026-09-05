import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, preview, type PreviewServer, type ViteDevServer } from "vite";
import { cdpEvaluate, ephemeralPort, launchChrome, type ChromeHandle } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PNG_MAGIC = "89504e47";

async function assertPng(buf: ArrayBuffer): Promise<number> {
  const bytes = new Uint8Array(buf);
  const head = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  expect(head).toBe(PNG_MAGIC);
  expect(bytes.length).toBeGreaterThan(100);
  return bytes.length;
}

// ---------------------------------------------------------------------------
// backend cells: SSR-style middleware renders through the server, the test
// only fetches PNG bytes over HTTP and checks the magic.
// ---------------------------------------------------------------------------

describe.each([{ mode: "dev" }, { mode: "build" }])("backend [$mode]", ({ mode }) => {
  let server: ViteDevServer | PreviewServer | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    if (mode === "dev") {
      const dev = await createServer({
        root: ROOT,
        logLevel: "warn",
        server: { host: "127.0.0.1", port: await ephemeralPort(), strictPort: true },
      });
      await dev.listen();
      const addr = dev.httpServer?.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      server = dev;
    } else {
      await build({ root: ROOT, logLevel: "warn" });
      const pv = await preview({
        root: ROOT,
        logLevel: "warn",
        preview: { host: "127.0.0.1", port: await ephemeralPort(), strictPort: true },
      });
      const local = pv.resolvedUrls?.local?.[0]?.replace(/\/$/, "");
      if (!local) throw new Error("preview server URL unknown");
      baseUrl = local;
      server = pv;
    }
  }, 180000);

  afterAll(async () => {
    await server?.close();
  });

  it(
    "renders PNG through the server middleware",
    async () => {
      const res = await fetch(`${baseUrl}/__render`);
      expect(res.ok).toBe(true);
      const len = await assertPng(await res.arrayBuffer());
      console.log(`backend[${mode}]: PNG ${len}B via ${baseUrl}/__render`);
    },
    120000,
  );
});

// ---------------------------------------------------------------------------
// web cells: real Chromium opens the dev/preview URL, the page itself runs
// render() and exposes small metadata on window.__e2e (never full bytes).
// ---------------------------------------------------------------------------

describe.each([{ mode: "dev" }, { mode: "build" }])("web [$mode]", ({ mode }) => {
  let server: ViteDevServer | PreviewServer | undefined;
  let baseUrl = "";
  let chrome: ChromeHandle | undefined;

  beforeAll(async () => {
    if (mode === "dev") {
      const dev = await createServer({
        root: ROOT,
        logLevel: "warn",
        server: { host: "127.0.0.1", port: await ephemeralPort(), strictPort: true },
      });
      await dev.listen();
      const addr = dev.httpServer?.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      server = dev;
    } else {
      await build({ root: ROOT, logLevel: "warn" });
      const pv = await preview({
        root: ROOT,
        logLevel: "warn",
        preview: { host: "127.0.0.1", port: await ephemeralPort(), strictPort: true },
      });
      const local = pv.resolvedUrls?.local?.[0]?.replace(/\/$/, "");
      if (!local) throw new Error("preview server URL unknown");
      baseUrl = local;
      server = pv;
    }
    chrome = await launchChrome();
  }, 240000);

  afterAll(async () => {
    await chrome?.close();
    await server?.close();
  });

  it(
    "renders PNG inside Chromium via page.evaluate",
    async () => {
      const value = (await cdpEvaluate(
        chrome!.port,
        `${baseUrl}/`,
        "window.__e2e",
        120000,
      )) as { ok: boolean; len?: number; head?: number[]; error?: string };
      expect(value?.ok).toBe(true);
      expect(value?.head?.map((n) => n.toString(16).padStart(2, "0")).join("")).toBe(PNG_MAGIC);
      expect(value?.len ?? 0).toBeGreaterThan(100);
      console.log(`web[${mode}]: PNG ${value?.len}B rendered in Chromium`);
    },
    180000,
  );
});
