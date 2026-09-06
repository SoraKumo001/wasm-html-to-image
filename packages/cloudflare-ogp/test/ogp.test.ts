import { describe, expect, it } from "vitest";
import worker from "../src/index";

const PNG_MAGIC = "89504e47";

const headHex = (bytes: Uint8Array): string =>
  Array.from(bytes.subarray(0, 4))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");

// Minimal ExecutionContext stub: results are returned directly, so background
// cache writes are simply dropped (rejections swallowed to avoid noise).
type Ctx = Parameters<typeof worker.fetch>[2];
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    p.catch(() => {});
  },
  passThroughOnException: () => {},
} as unknown as Ctx;

describe("cloudflare-ogp entry", () => {
  it("returns 404 for non-root path", async () => {
    const res = await worker.fetch(
      new Request("https://ogp.example/not-found"),
      {},
      ctx,
    );
    expect(res.status).toBe(404);
  });

  // Rendering itself must succeed even if external font/image fetches fail
  // in the sandbox, so only PNG shape is asserted (no pixel comparison).
  it(
    "renders PNG for ?title=",
    async () => {
      const res = await worker.fetch(
        new Request("https://ogp.example/?title=Hello"),
        {},
        ctx,
      );
      expect(res.headers.get("Content-Type")).toContain("image/png");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(headHex(bytes)).toBe(PNG_MAGIC);
      expect(bytes.length).toBeGreaterThan(100);
      console.log(`ogp png: ${bytes.length}B`);
    },
    180000,
  );
});
