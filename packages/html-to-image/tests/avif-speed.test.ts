import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";

// Regression: AVIF at speed 4 or 5 used to overflow the 64 KB wasm stack, which
// silently corrupted memory and made the NEXT encode in the module throw
// "memory access out of bounds". Real wasm, same module across all calls.
const html =
  "<div style='padding:20px;font:24px sans-serif;background:linear-gradient(#369,#9cf)'>" +
  "AVIF speed regression</div>";

const avif = async (speed: number): Promise<Uint8Array> => {
  const r = await render({ value: html, width: 400, format: "avif", speed, fontMap: {} });
  return r.data as Uint8Array;
};

describe("AVIF encode at every speed", () => {
  it("keeps encoding after a slow-path (speed 4 / 5) encode", async () => {
    // Order matters: each slow-path encode must be followed by another encode.
    for (const speed of [4, 6, 5, 6, 4, 5, 8, 4, 8]) {
      const data = await avif(speed);
      expect(data.length).toBeGreaterThan(100);
    }
  }, 60_000);

  it("produces a valid AVIF (ftyp avif) at speeds 0-10", async () => {
    for (const speed of [0, 3, 4, 5, 6, 8, 10]) {
      const data = await avif(speed);
      expect(Buffer.from(data.subarray(4, 12)).toString("latin1")).toMatch(/^ftyp(avif|avis|mif1)/);
    }
  }, 120_000);
});
