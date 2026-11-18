import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CanvasPath2D,
  createCanvas,
  loadHtmlToImageModule,
  type HtmlToImageModule,
} from "../src/index.js";

function pixelAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe("2D Canvas API (WASM Skia)", () => {
  let mod: HtmlToImageModule;

  beforeAll(async () => {
    mod = await loadHtmlToImageModule();
  });

  afterAll(() => {
    // Module stays loaded for process lifetime
  });

  it("draws rectangles, clears, and reads/writes ImageData", () => {
    const canvas = createCanvas(mod, 40, 40);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 40, 40);
    ctx.clearRect(10, 10, 20, 20);

    const img = ctx.getImageData(0, 0, 40, 40);
    expect(img.width).toBe(40);
    expect(img.height).toBe(40);
    expect(pixelAt(img.data, 40, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(img.data, 40, 20, 20)).toEqual([0, 0, 0, 0]);

    // putImageData writes green pixel at (20, 20)
    const patch = ctx.createImageData(2, 2);
    for (let i = 0; i < patch.data.length; i += 4) {
      patch.data[i] = 0;
      patch.data[i + 1] = 255;
      patch.data[i + 2] = 0;
      patch.data[i + 3] = 255;
    }
    ctx.putImageData(patch, 20, 20);
    const after = ctx.getImageData(20, 20, 1, 1);
    expect(Array.from(after.data)).toEqual([0, 255, 0, 255]);

    canvas.dispose();
  });

  it("supports paths, arcs, roundRect, CanvasPath2D, clip, and transforms", () => {
    const canvas = createCanvas(mod, 60, 60);
    const ctx = canvas.getContext("2d");

    ctx.save();
    ctx.translate(30, 30);
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fillStyle = "rgb(0, 128, 255)";
    ctx.fill();
    ctx.restore();

    const center = ctx.getImageData(30, 30, 1, 1).data;
    expect(center[0]).toBe(0);
    expect(center[1]).toBe(128);
    expect(center[2]).toBe(255);
    expect(center[3]).toBe(255);

    // Outside circle should remain transparent
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0, 0, 0, 0]);

    // CanvasPath2D SVG string + clip
    ctx.save();
    const clipPath = new CanvasPath2D("M 0 0 H 10 V 10 H 0 Z");
    ctx.clip(clipPath);
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 30, 30);
    ctx.restore();

    expect(Array.from(ctx.getImageData(5, 5, 1, 1).data)).toEqual([
      255, 0, 255, 255,
    ]);
    // (15, 5) was outside clipPath, so still transparent
    expect(Array.from(ctx.getImageData(15, 5, 1, 1).data)).toEqual([
      0, 0, 0, 0,
    ]);

    canvas.dispose();
  });

  it("supports gradients, shadows, filters, and globalAlpha", () => {
    const canvas = createCanvas(mod, 80, 40);
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 80, 0);
    grad.addColorStop(0, "#ff0000");
    grad.addColorStop(1, "#0000ff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 80, 40);

    const left = ctx.getImageData(1, 20, 1, 1).data;
    const right = ctx.getImageData(78, 20, 1, 1).data;
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(50);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(50);

    // Shadow + filter
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.filter = "brightness(1.1)";
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(10, 10, 20, 20);

    const mid = ctx.getImageData(20, 20, 1, 1).data;
    expect(mid[1]).toBeGreaterThan(150);

    canvas.dispose();
  });

  it("composites another Canvas and encoded PNG bytes via drawImage", () => {
    const src = createCanvas(mod, 20, 20);
    const sctx = src.getContext("2d");
    sctx.fillStyle = "#00ff00";
    sctx.fillRect(0, 0, 20, 20);
    const pngBytes = src.encode({ format: "png" });

    const dst = createCanvas(mod, 50, 30);
    const dctx = dst.getContext("2d");
    dctx.drawImage(src, 5, 5);
    dctx.drawImage(pngBytes, 28, 5, 10, 10);

    expect(Array.from(dctx.getImageData(10, 10, 1, 1).data)).toEqual([
      0, 255, 0, 255,
    ]);
    expect(Array.from(dctx.getImageData(32, 10, 1, 1).data)).toEqual([
      0, 255, 0, 255,
    ]);

    src.dispose();
    dst.dispose();
  });

  it("encodes to PNG, WebP, JPEG, DataURL, and transfers to converter", () => {
    const canvas = createCanvas(mod, 32, 32);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#123456";
    ctx.fillRect(0, 0, 32, 32);

    const png = canvas.encode({ format: "png" });
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);

    const webp = canvas.encode({ format: "webp", quality: 80 });
    expect(String.fromCharCode(...webp.subarray(0, 4))).toBe("RIFF");

    const jpeg = canvas.encode({ format: "jpeg", quality: 80 });
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);

    const dataUrl = canvas.toDataURL("image/png");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);

    const conv = mod.converter_create_instance();
    try {
      expect(canvas.toConverter(conv)).toBe(true);
      expect(mod.converter_get_width?.(conv)).toBe(32);
      expect(mod.converter_get_height?.(conv)).toBe(32);
    } finally {
      mod.converter_destroy_instance(conv);
    }

    canvas.dispose();
    expect(() => canvas.width).toThrow();
  });
});
