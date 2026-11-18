import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";
import {
  createDOM,
  installCanvasBridge,
  type CanvasBridge,
} from "../src/edge-js.js";
import { loadHtmlToImageModule } from "../src/loader.js";

function pixelAt(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe("HTML <canvas> + wasm-quickjs-dom integration", () => {
  it("renders <canvas> drawn by inline <script> via render({ javascript: { canvas: true } })", async () => {
    const html = `<!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#ffffff;">
          <canvas id="c" width="100" height="80"></canvas>
          <script>
            const c = document.getElementById("c");
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#ff0000";
            ctx.fillRect(0, 0, 50, 80);
            ctx.fillStyle = "#00ff00";
            ctx.fillRect(50, 0, 50, 80);
            const p = new Path2D("M 10 10 H 30 V 30 H 10 Z");
            ctx.fillStyle = "#0000ff";
            ctx.fill(p);
          </script>
        </body>
      </html>`;

    const res = await render({
      value: html,
      width: 100,
      height: 80,
      format: "raw",
      javascript: { canvas: true, settleMs: 0 },
    });

    expect(res.data).toBeInstanceOf(Uint8Array);
    const rgba = res.data as Uint8Array;
    // (20, 20) is inside the blue Path2D square
    expect(pixelAt(rgba, 100, 20, 20)).toEqual([0, 0, 255, 255]);
    // (40, 40) is red
    expect(pixelAt(rgba, 100, 40, 40)).toEqual([255, 0, 0, 255]);
    // (75, 40) is green
    expect(pixelAt(rgba, 100, 75, 40)).toEqual([0, 255, 0, 255]);
  });

  it("supports getImageData, putImageData, toDataURL, resize, and OffscreenCanvas via installCanvasBridge", async () => {
    const mod = await loadHtmlToImageModule();
    let bridge: CanvasBridge | undefined;
    const dom = await createDOM(
      { html: `<canvas id="c" width="20" height="20"></canvas>` },
      {
        settleMs: 0,
        async beforeStart(page) {
          bridge = await installCanvasBridge(page.dom, mod);
        },
      },
    );

    try {
      const result = await dom.eval(() => {
        const c = document.getElementById("c") as HTMLCanvasElement;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#112233";
        ctx.fillRect(0, 0, 20, 20);
        const px = ctx.getImageData(5, 5, 1, 1);
        const url = c.toDataURL("image/png");

        // OffscreenCanvas
        const oc = new OffscreenCanvas(10, 10);
        const octx = oc.getContext("2d")!;
        octx.fillStyle = "#00ff00";
        octx.fillRect(0, 0, 10, 10);
        const opx = octx.getImageData(2, 2, 1, 1);

        return {
          px: Array.from(px.data),
          isPngUrl: url.startsWith("data:image/png;base64,"),
          opx: Array.from(opx.data),
        };
      });

      expect(result.px).toEqual([0x11, 0x22, 0x33, 255]);
      expect(result.isPngUrl).toBe(true);
      expect(result.opx).toEqual([0, 255, 0, 255]);
    } finally {
      bridge?.dispose();
      dom.close();
    }
  });

  it("supports host-driven 2D canvas drawing on JSDOM / Vitest window globals", async () => {
    const { JSDOM } = await import("wasm-quickjs-dom/jsdom");
    const dom = new JSDOM(`<!DOCTYPE html><canvas id="c" width="30" height="30"></canvas>`);
    const bridge = await installCanvasBridge(dom);

    try {
      const doc = dom.window.document;
      const canvas = doc.getElementById("c") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      expect(ctx).not.toBeNull();
      expect(ctx.canvas).toBe(canvas);

      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 30, 30);

      const px = ctx.getImageData(10, 10, 1, 1);
      expect(px.data).toBeInstanceOf(Uint8ClampedArray);
      expect(Array.from(px.data)).toEqual([255, 0, 0, 255]);

      const url = canvas.toDataURL("image/png");
      expect(url.startsWith("data:image/png;base64,")).toBe(true);

      // Drawing one HTMLCanvasElement into another on the host
      const canvas2 = doc.createElement("canvas") as HTMLCanvasElement;
      canvas2.width = 30;
      canvas2.height = 30;
      const ctx2 = canvas2.getContext("2d")!;
      ctx2.drawImage(canvas, 0, 0);
      expect(Array.from(ctx2.getImageData(15, 15, 1, 1).data)).toEqual([
        255, 0, 0, 255,
      ]);
    } finally {
      bridge.dispose();
      dom.close();
    }
  });

  it("works when installed on Vitest global window (register / unregister)", async () => {
    const { register, unregister } = await import("wasm-quickjs-dom/jsdom");
    register({ url: "http://localhost:3000" });
    const bridge = await installCanvasBridge(globalThis.window);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 40;
      document.body.appendChild(canvas);

      const ctx = canvas.getContext("2d")!;
      expect(ctx).not.toBeNull();

      // Path2D + fill + ImageData on globalThis
      const path = new Path2D("M 5 5 H 25 V 25 H 5 Z");
      ctx.fillStyle = "rgb(0, 200, 100)";
      ctx.fill(path);

      const hit = ctx.getImageData(10, 10, 1, 1);
      expect(hit).toBeInstanceOf(ImageData);
      expect(Array.from(hit.data)).toEqual([0, 200, 100, 255]);

      const miss = ctx.getImageData(35, 35, 1, 1);
      expect(Array.from(miss.data)).toEqual([0, 0, 0, 0]);

      // OffscreenCanvas on globalThis
      const offscreen = new OffscreenCanvas(20, 20);
      const octx = offscreen.getContext("2d")!;
      octx.fillStyle = "#123456";
      octx.fillRect(0, 0, 20, 20);
      const blob = await offscreen.convertToBlob({ type: "image/png" });
      expect(blob.type).toBe("image/png");
      expect(blob.size).toBeGreaterThan(20);
    } finally {
      bridge.dispose();
      unregister();
    }
  });
});
