import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRenderOptions,
  isUrlInput,
  DEFAULT_ANIMATION_FPS,
  type CliFlags,
} from "../src/cli-options.js";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/cli-input.html", import.meta.url),
);

const flags = (overrides: Partial<CliFlags> = {}): CliFlags => ({
  width: 800,
  format: "png",
  quality: 85,
  ...overrides,
});

describe("cli options", () => {
  it("treats schemes as URLs but Windows paths and data: URLs as files/values", () => {
    expect(isUrlInput("https://example.com/news")).toBe(true);
    expect(isUrlInput("http://127.0.0.1:8080/base/final.html")).toBe(true);
    expect(isUrlInput("C:\\pages\\template.html")).toBe(false);
    expect(isUrlInput("template.html")).toBe(false);
    expect(isUrlInput("data:image/png;base64,AAAA")).toBe(false);
  });

  it("bases a file input on its own directory", async () => {
    const options = await buildRenderOptions(FIXTURE, flags());
    expect(options.value).toContain("cli fixture");
    expect(options.baseUrl).toBe(path.dirname(FIXTURE));
  });

  it("lets an explicit --base-url override a file input's directory", async () => {
    const options = await buildRenderOptions(
      FIXTURE,
      flags({ baseUrl: "/srv/assets" }),
    );
    expect(options.value).toContain("cli fixture");
    expect(options.baseUrl).toBe("/srv/assets");
  });

  it("maps --color-space to colorSpace", async () => {
    const cmyk = await buildRenderOptions(
      FIXTURE,
      flags({ format: "tiff", colorSpace: "cmyk" }),
    );
    expect(cmyk).toMatchObject({ format: "tiff", colorSpace: "cmyk" });
  });

  it("maps --scale and --dpi", async () => {
    const o = await buildRenderOptions(
      FIXTURE,
      flags({ format: "tiff", scale: 3.125, dpi: 300 }),
    );
    expect(o).toMatchObject({ scale: 3.125, dpi: 300 });
  });

  describe("animation flags", () => {
    it("maps --animation to { duration, fps } and honors an explicit fps", async () => {
      const options = await buildRenderOptions(
        FIXTURE,
        flags({ format: "webp", animation: 2000 }),
      );
      expect(options.format).toBe("webp");
      expect(options.animation).toEqual({
        duration: 2000,
        fps: DEFAULT_ANIMATION_FPS,
      });

      const explicit = await buildRenderOptions(
        FIXTURE,
        flags({ format: "webp", animation: 2000, animationFps: 30 }),
      );
      expect(explicit.animation).toEqual({ duration: 2000, fps: 30 });
    });

    it("ignores --animation for non-webp formats with a warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const options = await buildRenderOptions(
          FIXTURE,
          flags({ format: "png", animation: 1000 }),
        );
        expect(options).not.toHaveProperty("animation");
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0][0])).toContain("webp");
      } finally {
        warn.mockRestore();
      }
    });
  });
});
