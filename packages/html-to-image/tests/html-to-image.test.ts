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
// 1x1 transparent PNG (base64), for the data: URL path.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
    converter_encode_pdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    satoru_render: vi.fn(async () => new Uint8Array([7, 7, 7])),
    html_to_image: vi.fn(async () => new Uint8Array([8, 8, 8])),
    ...overrides,
  };
  return { mod: calls as unknown as HtmlToImageModule, calls };
}

const baseOptions = (extra?: Partial<HtmlToImageOptions>): HtmlToImageOptions => ({
  value: "<h1>hi</h1>",
  width: 800,
  height: 600,
  format: "png",
  ...extra,
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
    expect(out).toEqual(new Uint8Array([8, 8, 8]));
    expect(calls.html_to_image).toHaveBeenCalledTimes(1);
    expect(calls.html_to_image).toHaveBeenCalledWith(
      "<h1>hi</h1>",
      800,
      600,
      2, // webp
      {},
      85,
      6,
      false,
    );
    expect(calls.satoru_render).toBeUndefined();
    expect(calls.converter_encode).not.toHaveBeenCalled();
  });

  it("decodes svg output to string", async () => {
    const svgBytes = new TextEncoder().encode("<svg></svg>");
    const { mod } = stubModule({
      ...noInstanceRender,
      html_to_image: vi.fn(async () => svgBytes),
    });
    const out = await htmlToImage(mod, baseOptions({ format: "svg" }));
    expect(typeof out).toBe("string");
    expect(out).toBe("<svg></svg>");
  });

  it("throws when the unified binding returns null", async () => {
    const { mod } = stubModule({
      ...noInstanceRender,
      html_to_image: vi.fn(async () => null),
    });
    await expect(htmlToImage(mod, baseOptions())).rejects.toThrow(
      /html_to_image returned null/,
    );
  });

  it("fetches HTML from url when value is missing", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "<p>u</p>" }));
    vi.stubGlobal("fetch", fetchMock);
    const { mod, calls } = stubModule(noInstanceRender);
    await htmlToImage(mod, { width: 100, url: "https://example.com/" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ headers: expect.anything() }),
    );
    expect(calls.html_to_image).toHaveBeenCalledWith(
      "<p>u</p>",
      100,
      0,
      1, // png
      {},
      85,
      6,
      false,
    );
  });

  it("throws when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const { mod } = stubModule();
    await expect(
      htmlToImage(mod, { width: 100, url: "https://example.com/" }),
    ).rejects.toThrow(/failed to fetch/);
  });

  it("throws when neither value nor url is given", async () => {
    const { mod } = stubModule();
    await expect(htmlToImage(mod, { width: 100 })).rejects.toThrow(
      /either 'value' or 'url'/,
    );
  });
});

describe("htmlToImage: HTML via 2-call fallback (no unified binding)", () => {
  const noUnified = { html_to_image: undefined as never };

  it("renders svg/pdf directly with satoru_render", async () => {
    const { mod, calls } = stubModule(noUnified);
    const out = await htmlToImage(mod, baseOptions({ format: "svg" }));
    expect(typeof out).toBe("string");
    expect(calls.satoru_render).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<h1>hi</h1>",
      800,
      600,
      0, // svg
      {},
    );
    expect(calls.converter_encode).not.toHaveBeenCalled();
    expect(calls.satoru_destroy_instance).toHaveBeenCalledWith({ tag: "satoru" });
  });

  it("renders raster via satoru PNG intermediate + converter_encode", async () => {
    const { mod, calls } = stubModule(noUnified);
    const out = await htmlToImage(mod, baseOptions({ format: "webp" }));
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_render).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<h1>hi</h1>",
      800,
      600,
      1, // png intermediate
      {},
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
    );
    expect(calls.converter_destroy_instance).toHaveBeenCalledWith({
      tag: "converter",
    });
  });

  it("throws when satoru_render is unregistered", async () => {
    const { mod } = stubModule({
      html_to_image: undefined as never,
      satoru_render: undefined as never,
    });
    await expect(htmlToImage(mod, baseOptions())).rejects.toThrow(
      /binding "satoru_render" is required/,
    );
  });

  it("throws when satoru_render returns null", async () => {
    const { mod } = stubModule({
      html_to_image: undefined as never,
      satoru_render: vi.fn(async () => null),
    });
    await expect(htmlToImage(mod, baseOptions())).rejects.toThrow(
      /satoru_render returned null/,
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
      parts.push(new Uint8Array([e.type, 0]), u32(ub.length), ub, u32(0), u32(0));
    }
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  const withDiscovery = (extra: Record<string, ReturnType<typeof vi.fn>> = {}) =>
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
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => imgBytes.buffer })),
    );
    const bin = pendingBin([{ type: 2, url: "https://example.com/a.jpg" }]);
    const { mod, calls } = withDiscovery({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(bin as never),
    });
    const out = await htmlToImage(
      mod,
      baseOptions({ value: "<img src='https://example.com/a.jpg'>", format: "png" }),
    );
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_collect_resources).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<img src='https://example.com/a.jpg'>",
      800,
      600,
      0,
    );
    expect(calls.satoru_add_resource).toHaveBeenCalledWith(
      { tag: "satoru" },
      "https://example.com/a.jpg",
      2,
      imgBytes,
    );
    // Instance render path (not unified) since resources were resolved.
    expect(calls.satoru_render).toHaveBeenCalled();
    expect(calls.html_to_image).not.toHaveBeenCalled();
  });

  it("skips data: URLs (resolved inline by C++)", async () => {
    const bin = pendingBin([{ type: 2, url: "data:image/png;base64,iVBOR" }]);
    const { mod, calls } = withDiscovery({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(bin as never),
    });
    await htmlToImage(mod, baseOptions({ format: "png" }));
    expect(calls.satoru_add_resource).not.toHaveBeenCalled();
    expect(calls.satoru_render).toHaveBeenCalled();
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

  it("proceeds when fetch fails for a resource", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const bin = pendingBin([{ type: 1, url: "https://example.com/f.woff2" }]);
    const { mod, calls } = withDiscovery({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(bin as never)
        .mockResolvedValueOnce(bin as never),
    });
    const out = await htmlToImage(mod, baseOptions({ format: "png" }));
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.satoru_add_resource).not.toHaveBeenCalled();
  });
});

describe("htmlToImage: default fontMap resolution", () => {
  const withFontDiscovery = (
    fontUrls: string[],
    extra: Record<string, ReturnType<typeof vi.fn>> = {},
  ) => {
    const bins = fontUrls.map((url) => {
      const ub = new TextEncoder().encode(url);
      const u32 = (n: number): Uint8Array =>
        new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
      const parts = [u32(1), new Uint8Array([1, 0]), u32(ub.length), ub, u32(0), u32(0)];
      const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    });
    let round = 0;
    return stubModule({
      satoru_collect_resources: vi.fn(),
      satoru_get_pending_resources: vi.fn(async () =>
        round < bins.length ? bins[round++] : null,
      ),
      satoru_add_resource: vi.fn(),
      satoru_set_font_map: vi.fn(),
      ...extra,
    });
  };

  it("applies DEFAULT_FONT_MAP before discovery", async () => {
    const { mod, calls } = withFontDiscovery([]);
    await htmlToImage(mod, baseOptions({ format: "png" }));
    expect(calls.satoru_set_font_map).toHaveBeenCalledWith(
      { tag: "satoru" },
      DEFAULT_FONT_MAP,
    );
    expect(DEFAULT_FONT_MAP["sans-serif"]).toContain("fonts.googleapis.com");
  });

  it("honors a custom fontMap override", async () => {
    const custom = { "sans-serif": "https://example.com/sans.css" };
    const { mod, calls } = withFontDiscovery([]);
    await htmlToImage(mod, baseOptions({ format: "png", fontMap: custom }));
    expect(calls.satoru_set_font_map).toHaveBeenCalledWith(
      { tag: "satoru" },
      custom,
    );
  });

  it("fetches each font URL once across renders (cache)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cssUrl = "https://example.com/cache-a.css";
    const opts = baseOptions({ format: "png" });
    const first = withFontDiscovery([cssUrl]);
    await htmlToImage(first.mod, opts);
    expect(first.calls.satoru_add_resource).toHaveBeenCalledTimes(1);
    const second = withFontDiscovery([cssUrl]);
    await htmlToImage(second.mod, opts);
    expect(second.calls.satoru_add_resource).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("htmlToImage: fallbackFonts injection", () => {
  const withFallbackDiscovery = (
    extra: Record<string, ReturnType<typeof vi.fn>> = {},
  ) =>
    stubModule({
      satoru_collect_resources: vi.fn(),
      satoru_get_pending_resources: vi.fn(async () => null),
      satoru_add_resource: vi.fn(),
      satoru_set_font_map: vi.fn(),
      satoru_load_fallback_font: vi.fn(),
      ...extra,
    });

  it("applies byte fallbacks before discovery", async () => {
    const bytes = new Uint8Array([10, 20, 30]);
    const { mod, calls } = withFallbackDiscovery();
    await htmlToImage(mod, baseOptions({ format: "png", fallbackFonts: [bytes] }));
    expect(calls.satoru_load_fallback_font).toHaveBeenCalledWith(
      { tag: "satoru" },
      bytes,
    );
    // Discovery still runs afterwards on the same instance.
    expect(calls.satoru_collect_resources).toHaveBeenCalled();
    expect(calls.satoru_render).toHaveBeenCalled();
  });

  it("fetches URL fallbacks before applying", async () => {
    const fontBytes = new Uint8Array([7, 8, 9]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => fontBytes.buffer })),
    );
    const { mod, calls } = withFallbackDiscovery();
    await htmlToImage(
      mod,
      baseOptions({
        format: "png",
        fallbackFonts: ["https://example.com/fb.woff2"],
      }),
    );
    expect(calls.satoru_load_fallback_font).toHaveBeenCalledWith(
      { tag: "satoru" },
      fontBytes,
    );
  });

  it("skips gracefully when the binding is missing", async () => {
    const { mod, calls } = withFallbackDiscovery({
      satoru_load_fallback_font: undefined as never,
    });
    const out = await htmlToImage(
      mod,
      baseOptions({ format: "png", fallbackFonts: [new Uint8Array([1])] }),
    );
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
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
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.html_to_image).not.toHaveBeenCalled();
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
    );
    expect(calls.converter_destroy_instance).toHaveBeenCalled();
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
    expect(calls.converter_encode).toHaveBeenCalledWith(
      { tag: "converter" },
      4, // jpeg
      85,
      6,
      false,
    );
  });

  it("decodes data: URLs to bytes before loading", async () => {
    const { mod, calls } = stubModule();
    await htmlToImage(mod, baseOptions({ value: PNG_DATA_URL, format: "png" }));
    const loaded: Uint8Array = calls.converter_load_image.mock.calls[0][1];
    expect(loaded[0]).toBe(0x89);
    expect(loaded[1]).toBe(0x50);
    expect(loaded[2]).toBe(0x4e);
    expect(loaded[3]).toBe(0x47);
  });

  it("routes image input to converter_encode_svg/pdf", async () => {
    const { mod, calls } = stubModule();
    const svg = await htmlToImage(mod, baseOptions({ value: PNG_BYTES, format: "svg" }));
    expect(svg).toBe("<svg><image/></svg>");
    expect(calls.converter_encode_svg).toHaveBeenCalledWith({ tag: "converter" });
    const pdf = await htmlToImage(mod, baseOptions({ value: PNG_BYTES, format: "pdf" }));
    expect(pdf).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(calls.converter_encode_pdf).toHaveBeenCalledWith({ tag: "converter" });
  });

  it("throws when converter bindings are unregistered", async () => {
    const noLoad = stubModule({ converter_load_image: undefined as never });
    await expect(
      htmlToImage(noLoad.mod, baseOptions({ value: PNG_BYTES })),
    ).rejects.toThrow(/binding "converter_load_image" is required/);

    const noEncode = stubModule({ converter_encode: undefined as never });
    await expect(
      htmlToImage(noEncode.mod, baseOptions({ value: PNG_BYTES })),
    ).rejects.toThrow(/binding "converter_encode" is required/);

    const noSvg = stubModule({ converter_encode_svg: undefined as never });
    await expect(
      htmlToImage(noSvg.mod, baseOptions({ value: PNG_BYTES, format: "svg" })),
    ).rejects.toThrow(/binding "converter_encode_svg" is required/);

    const noPdf = stubModule({ converter_encode_pdf: undefined as never });
    await expect(
      htmlToImage(noPdf.mod, baseOptions({ value: PNG_BYTES, format: "pdf" })),
    ).rejects.toThrow(/binding "converter_encode_pdf" is required/);
  });

  it("throws when loading or encoding fails", async () => {
    const badLoad = stubModule({ converter_load_image: vi.fn(() => false) });
    await expect(
      htmlToImage(badLoad.mod, baseOptions({ value: PNG_BYTES })),
    ).rejects.toThrow(/failed to load image input/);

    const nullEncode = stubModule({ converter_encode: vi.fn(async () => null) });
    await expect(
      htmlToImage(nullEncode.mod, baseOptions({ value: PNG_BYTES })),
    ).rejects.toThrow(/failed to encode image/);

    const emptySvg = stubModule({ converter_encode_svg: vi.fn(async () => "") });
    await expect(
      htmlToImage(emptySvg.mod, baseOptions({ value: PNG_BYTES, format: "svg" })),
    ).rejects.toThrow(/failed to encode image to svg/);
  });
});
