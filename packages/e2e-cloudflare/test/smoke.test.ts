import { describe, expect, it } from "vitest";
import { render } from "wasm-html-to-image/workerd";

const PNG_MAGIC = "89504e47";

const headHex = (bytes: Uint8Array): string =>
  Array.from(bytes.subarray(0, 4))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");

describe("cloudflare workerd entry", () => {
  it(
    "renders PNG (magic + length)",
    async () => {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "png",
      });
      expect(out).toBeInstanceOf(Uint8Array);
      const bytes = out as Uint8Array;
      expect(headHex(bytes)).toBe(PNG_MAGIC);
      expect(bytes.length).toBeGreaterThan(100);
      console.log(`png: ${bytes.length}B`);
    },
    180000,
  );

  it(
    "renders SVG as string",
    async () => {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "svg",
      });
      expect(typeof out).toBe("string");
      expect((out as string).length).toBeGreaterThan(0);
      console.log(`svg: ${(out as string).length} chars`);
    },
    180000,
  );

  it(
    "rejects invalid input",
    async () => {
      await expect(
        render({ width: 800, format: "png" } as never),
      ).rejects.toThrow();
    },
    180000,
  );
});
