import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_FONT_MAP,
  htmlToImage,
  type HtmlToImageOptions,
} from "../src/core.js";
import type { HtmlToImageModule } from "../src/loader.js";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type StubBindings = Record<string, ReturnType<typeof vi.fn>>;

function stubModule(overrides: StubBindings = {}): {
  mod: HtmlToImageModule;
  calls: StubBindings;
} {
  const calls: StubBindings = {
    satoru_create_instance: vi.fn(() => ({ tag: "satoru" })),
    satoru_destroy_instance: vi.fn(),
    satoru_set_log_level: vi.fn(),
    converter_create_instance: vi.fn(() => ({ tag: "converter" })),
    converter_destroy_instance: vi.fn(),
    converter_set_log_level: vi.fn(),
    converter_load_image: vi.fn(() => true),
    converter_crop: vi.fn(() => true),
    converter_resize: vi.fn(() => true),
    converter_encode: vi.fn(async () => new Uint8Array([9, 9, 9])),
    converter_encode_svg: vi.fn(async () => "<svg><image/></svg>"),
    converter_encode_pdf: vi.fn(
      async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    ),
    satoru_render: vi.fn(async () => new Uint8Array([7, 7, 7])),
    html_to_image: vi.fn(async () => new Uint8Array([8, 8, 8])),
    ...overrides,
  };
  return { mod: calls as unknown as HtmlToImageModule, calls };
}

const baseOptions = (
  extra?: Partial<HtmlToImageOptions>,
): HtmlToImageOptions => ({
  value: "<h1>hi</h1>",
  width: 800,
  height: 600,
  format: "png",
  ...extra,
});

// Parity defaults: text-to-paths on, screen media, blank PDF metadata.
const SATORU_DEFAULTS = expect.objectContaining({
  svgTextToPaths: true,
  mediaType: 0,
  pdfTitle: "",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("htmlToImage: HTML via unified binding (legacy fallback)", () => {
  // The unified binding is only reached when the instance render bindings
  // are absent (it builds its own instance and cannot see resolved resources).
  const noInstanceRender = { satoru_render: undefined as never };

  it("calls html_to_image with positional args and returns bytes", async () => {
    const { mod, calls } = stubModule(noInstanceRender);
    const out = await htmlToImage(mod, baseOptions({ format: "webp" }));
    expect(out.data).toEqual(new Uint8Array([8, 8, 8]));
    expect(calls.html_to_image).toHaveBeenCalledTimes(1);
    expect(calls.html_to_image).toHaveBeenCalledWith(
      "<h1>hi</h1>",
      800,
      600,
      2, // webp
      SATORU_DEFAULTS,
      85,
      6,
      false,
    );
    expect(calls.converter_encode).not.toHaveBeenCalled();
  });
});

describe("htmlToImage: HTML via 2-call fallback (no unified binding)", () => {
  const noUnified = { html_to_image: undefined as never };

  it("renders svg directly with satoru_render", async () => {
    const { mod, calls } = stubModule(noUnified);
    const out = await htmlToImage(mod, baseOptions({ format: "svg" }));
    expect(typeof out.data).toBe("string");
    expect(calls.satoru_render).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<h1>hi</h1>",
      800,
      600,
      0, // svg
      SATORU_DEFAULTS,
    );
    expect(calls.converter_encode).not.toHaveBeenCalled();
  });

  it("renders raster via satoru PNG intermediate + converter_encode", async () => {
    const { mod, calls } = stubModule(noUnified);
    const out = await htmlToImage(mod, baseOptions({ format: "webp" }));
    expect(out.data).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_render).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<h1>hi</h1>",
      800,
      600,
      1, // png intermediate
      SATORU_DEFAULTS,
    );
    expect(calls.converter_load_image).toHaveBeenCalledWith(
      { tag: "converter" },
      new Uint8Array([7, 7, 7]),
    );
    expect(calls.converter_encode).toHaveBeenCalledWith(
      { tag: "converter" },
      2, // webp
      85,
      6,
      false,
      0, // animation loop (0 = infinite)
    );
  });
});

describe("htmlToImage: resource discovery loop", () => {
  const enc = new TextEncoder();
  const u32 = (n: number): Uint8Array =>
    new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

  const pendingBin = (entries: { type: number; url: string }[]): Uint8Array => {
    const parts: Uint8Array[] = [u32(entries.length)];
    for (const e of entries) {
      const ub = enc.encode(e.url);
      parts.push(
        new Uint8Array([e.type, 0]),
        u32(ub.length),
        ub,
        u32(0),
        u32(0),
      );
    }
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  const withDiscovery = (
    extra: Record<string, ReturnType<typeof vi.fn>> = {},
  ) =>
    stubModule({
      satoru_collect_resources: vi.fn(),
      satoru_get_pending_resources: vi.fn(async () => null),
      satoru_add_resource: vi.fn(),
      ...extra,
    });

  it("fetches pending http resources and injects them before render", async () => {
    const imgBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => imgBytes.buffer,
      })),
    );
    const bin = pendingBin([{ type: 2, url: "https://example.com/a.jpg" }]);
    const { mod, calls } = withDiscovery({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(bin as never),
    });
    const out = await htmlToImage(
      mod,
      baseOptions({
        value: "<img src='https://example.com/a.jpg'>",
        format: "png",
      }),
    );
    expect(out.data).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_add_resource).toHaveBeenCalledWith(
      { tag: "satoru" },
      "https://example.com/a.jpg",
      2,
      imgBytes,
    );
    expect(calls.satoru_render).toHaveBeenCalled();
    expect(calls.html_to_image).not.toHaveBeenCalled();
  });

  it("resolves relative files against baseUrl on node", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hti-test-"));
    try {
      fs.writeFileSync(path.join(dir, "a.png"), PNG_BYTES);
      const bin = pendingBin([{ type: 2, url: "a.png" }]);
      const { mod, calls } = withDiscovery({
        satoru_get_pending_resources: vi
          .fn(async () => null)
          .mockResolvedValueOnce(bin as never),
      });
      await htmlToImage(mod, baseOptions({ format: "png", baseUrl: dir }));
      expect(calls.satoru_add_resource).toHaveBeenCalledWith(
        { tag: "satoru" },
        "a.png",
        2,
        PNG_BYTES,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves relative resources against the post-redirect final URL", async () => {
    const imgBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (target: string) => {
      if (target === "https://old.example/news/") {
        return {
          ok: true,
          url: "https://new.example/newsweb",
          text: async () => '<img src="a.png">',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      if (target === "https://new.example/a.png") {
        return {
          ok: true,
          url: target,
          arrayBuffer: async () => imgBytes.buffer,
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal("fetch", fetchMock);
    const bin = pendingBin([{ type: 2, url: "a.png" }]);
    const { mod, calls } = withDiscovery({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(bin as never),
    });
    // No explicit `baseUrl`: the base must follow the 301 to `new.example`.
    await htmlToImage(mod, { width: 100, url: "https://old.example/news/" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://new.example/a.png",
      expect.anything(),
    );
    expect(calls.satoru_add_resource).toHaveBeenCalledWith(
      { tag: "satoru" },
      "a.png",
      2,
      imgBytes,
    );
  });
});

describe("htmlToImage: fonts", () => {
  it("applies DEFAULT_FONT_MAP before discovery", async () => {
    const { mod, calls } = stubModule({
      satoru_collect_resources: vi.fn(),
      satoru_get_pending_resources: vi.fn(async () => null),
      satoru_add_resource: vi.fn(),
      satoru_set_font_map: vi.fn(),
    });
    await htmlToImage(mod, baseOptions({ format: "png" }));
    expect(calls.satoru_set_font_map).toHaveBeenCalledWith(
      { tag: "satoru" },
      DEFAULT_FONT_MAP,
    );
  });

  it("applies byte fallbacks before discovery", async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const { mod, calls } = stubModule({
      satoru_collect_resources: vi.fn(),
      satoru_get_pending_resources: vi.fn(async () => null),
      satoru_add_resource: vi.fn(),
      satoru_load_fallback_font: vi.fn(),
    });
    await htmlToImage(
      mod,
      baseOptions({ format: "png", fallbackFonts: [bytes] }),
    );
    expect(calls.satoru_load_fallback_font).toHaveBeenCalledWith(
      { tag: "satoru" },
      bytes,
    );
    expect(calls.satoru_render).toHaveBeenCalled();
  });
});

describe("htmlToImage: image input goes straight to converter_*", () => {
  it("encodes bytes without touching render bindings", async () => {
    const { mod, calls } = stubModule();
    const out = await htmlToImage(
      mod,
      baseOptions({ value: PNG_BYTES, format: "webp" }),
    );
    expect(out.data).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_render).not.toHaveBeenCalled();
    expect(calls.converter_load_image).toHaveBeenCalledWith(
      { tag: "converter" },
      PNG_BYTES,
    );
    expect(calls.converter_encode).toHaveBeenCalledWith(
      { tag: "converter" },
      2, // webp
      85,
      6,
      false,
      0, // animation loop (0 = infinite)
    );
  });

  it("forwards crop/resize to the converter", async () => {
    const { mod, calls } = stubModule();
    await htmlToImage(
      mod,
      baseOptions({
        value: PNG_BYTES,
        format: "jpeg",
        width: 320,
        height: 240,
        crop: { x: 1, y: 2, width: 100, height: 50 },
        fit: "cover",
      }),
    );
    expect(calls.converter_crop).toHaveBeenCalledWith(
      { tag: "converter" },
      1,
      2,
      100,
      50,
    );
    expect(calls.converter_resize).toHaveBeenCalledWith(
      { tag: "converter" },
      320,
      240,
      1, // cover
    );
  });

  it("routes colorSpace: cmyk to the CMYK encoders", async () => {
    // tiff carries the color space in the format int (11 = RGB, 12 = CMYK).
    const tiff = stubModule();
    await htmlToImage(tiff.mod, baseOptions({ value: PNG_BYTES, format: "tiff" }));
    await htmlToImage(
      tiff.mod,
      baseOptions({ value: PNG_BYTES, format: "tiff", colorSpace: "cmyk" }),
    );
    const formats = (
      tiff.calls.converter_encode as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[1]);
    expect(formats).toEqual([11, 12]);

    // image-input PDF uses its own binding.
    const pdf = stubModule({
      converter_encode_pdf_cmyk: vi.fn(async () => new Uint8Array([0x25, 0x50])),
    });
    const out = await htmlToImage(
      pdf.mod,
      baseOptions({ value: PNG_BYTES, format: "pdf", colorSpace: "cmyk" }),
    );
    expect(out.data).toEqual(new Uint8Array([0x25, 0x50]));
    expect(pdf.calls.converter_encode_pdf).not.toHaveBeenCalled();

    // HTML PDF: the color space rides in the satoru options.
    const html = stubModule();
    await htmlToImage(html.mod, baseOptions({ format: "pdf", colorSpace: "cmyk" }));
    const renderCall = (
      html.calls.satoru_render as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(renderCall[5]).toMatchObject({ colorSpace: 1 });
  });

  it("supports format: 'none' for image input (passthrough with metadata)", async () => {
    const { mod, calls } = stubModule({
      converter_get_original_width: vi.fn(() => 1024),
      converter_get_original_height: vi.fn(() => 768),
      converter_get_original_format: vi.fn(() => "png"),
      converter_is_original_animation: vi.fn(() => false),
    });
    const out = await htmlToImage(
      mod,
      baseOptions({ value: PNG_BYTES, format: "none" }),
    );
    expect(out.format).toBe("none");
    expect(out.data).toEqual(PNG_BYTES);
    expect(out.width).toBe(1024);
    expect(out.height).toBe(768);
    expect(out.originalFormat).toBe("png");
    expect(calls.converter_encode).not.toHaveBeenCalled();
  });
});
