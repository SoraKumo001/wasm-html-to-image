import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRenderOptions,
  isUrlInput,
  resolveAnimation,
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

  it("leaves baseUrl unset for URL input so the post-redirect URL wins", async () => {
    const options = await buildRenderOptions(
      "https://old.example/news/",
      flags(),
    );
    expect(options.url).toBe("https://old.example/news/");
    expect(options).not.toHaveProperty("baseUrl");
    expect(options).not.toHaveProperty("value");
  });

  it("pins an explicit --base-url for URL input", async () => {
    const options = await buildRenderOptions(
      "https://old.example/news/",
      flags({ baseUrl: "https://explicit.example/base/" }),
    );
    expect(options.url).toBe("https://old.example/news/");
    expect(options.baseUrl).toBe("https://explicit.example/base/");
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

  describe("animation flags", () => {
    it("is disabled by default", async () => {
      const options = await buildRenderOptions(FIXTURE, flags());
      expect(options).not.toHaveProperty("animation");
    });

    it("maps --animation to { duration, fps } for webp output", async () => {
      const options = await buildRenderOptions(
        FIXTURE,
        flags({ format: "webp", animation: 2000 }),
      );
      expect(options.format).toBe("webp");
      expect(options.animation).toEqual({
        duration: 2000,
        fps: DEFAULT_ANIMATION_FPS,
      });
    });

    it("honors an explicit --animation-fps", async () => {
      const options = await buildRenderOptions(
        FIXTURE,
        flags({ format: "webp", animation: 2000, animationFps: 30 }),
      );
      expect(options.animation).toEqual({ duration: 2000, fps: 30 });
    });

    it("keeps --base-url working together with animation", async () => {
      const options = await buildRenderOptions(
        FIXTURE,
        flags({
          format: "webp",
          animation: 1000,
          baseUrl: "https://explicit.example/base/",
        }),
      );
      expect(options.baseUrl).toBe("https://explicit.example/base/");
      expect(options.animation).toEqual({
        duration: 1000,
        fps: DEFAULT_ANIMATION_FPS,
      });
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

    it("warns when --animation-fps is given without --animation", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const options = await buildRenderOptions(
          FIXTURE,
          flags({ format: "webp", animationFps: 30 }),
        );
        expect(options).not.toHaveProperty("animation");
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0][0])).toContain("--animation");
      } finally {
        warn.mockRestore();
      }
    });

    it("resolveAnimation is pure (no console side effects)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(resolveAnimation(flags({ animation: 1000 }))).toEqual({
          warning:
            "--animation is only supported for webp output; ignoring (format=png).",
        });
      } finally {
        warn.mockRestore();
      }
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
