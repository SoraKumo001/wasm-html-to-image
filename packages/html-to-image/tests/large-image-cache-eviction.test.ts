import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB

  const rowLen = 1 + width * 3;
  const raw = new Uint8Array(rowLen * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowLen;
    raw[rowOff] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const px = rowOff + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const c1 = pngChunk("IHDR", ihdr);
  const c2 = pngChunk("IDAT", deflateSync(raw));
  const c3 = pngChunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let off = 0;
  for (const part of [sig, c1, c2, c3]) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

describe("large image decoded cache eviction & re-decoding", () => {
  it("renders all images even when total decoded RGBA exceeds 32 MiB", async () => {
    // 4 x (2200x2200 RGBA = 19.36 MiB) = 77.44 MiB > 32 MiB decoded cache cap.
    const assets: Record<string, Uint8Array> = {
      "https://example.test/img1.png": makeSolidPng(2200, 2200, 220, 40, 40),
      "https://example.test/img2.png": makeSolidPng(2200, 2200, 40, 180, 40),
      "https://example.test/img3.png": makeSolidPng(2200, 2200, 40, 80, 220),
      "https://example.test/img4.png": makeSolidPng(2200, 2200, 220, 180, 40),
    };
    const html = `
      <div style="display:flex;gap:8px;padding:8px;background:#fff">
        <img src="https://example.test/img1.png" width="40" height="40" />
        <img src="https://example.test/img2.png" width="40" height="40" />
        <img src="https://example.test/img3.png" width="40" height="40" />
        <img src="https://example.test/img4.png" width="40" height="40" />
      </div>
    `;
    const resolveResource = async (url: string) => assets[url] ?? null;

    const svgRes = await render({
      value: html,
      width: 240,
      height: 80,
      format: "svg",
      resolveResource,
      resourceCache: false,
    });
    const svg =
      typeof svgRes.data === "string"
        ? svgRes.data
        : new TextDecoder().decode(svgRes.data);
    const imageTags = svg.match(/<image\b/g) ?? [];
    expect(imageTags.length).toBe(4);

    const pngRes = await render({
      value: html,
      width: 240,
      height: 80,
      format: "png",
      resolveResource,
      resourceCache: false,
    });
    expect(pngRes.data).toBeInstanceOf(Uint8Array);
    expect((pngRes.data as Uint8Array).length).toBeGreaterThan(200);
  });
});
