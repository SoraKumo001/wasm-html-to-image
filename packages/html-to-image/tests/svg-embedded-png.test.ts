import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";

// 1x1 transparent PNG
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

describe("PNG embedded in SVG output", () => {
  it("image input to svg embeds a PNG that ends with a valid IEND chunk", async () => {
    const r = await render({ value: PNG_1X1, width: 1, format: "svg" });
    const m = (r.data as string).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    const bytes = Buffer.from(m![1], "base64");
    expect([...bytes.subarray(bytes.length - 12)]).toEqual(IEND);
  });
});
