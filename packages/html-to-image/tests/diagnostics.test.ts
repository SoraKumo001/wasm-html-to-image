import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_CODES,
  htmlToImage,
  LogLevel,
  type HtmlToImageOptions,
  type RenderDiagnostics,
} from "../src/core.js";
import type { HtmlToImageModule } from "../src/loader.js";

type StubBindings = Record<string, ReturnType<typeof vi.fn>>;

function stubModule(overrides: StubBindings = {}): {
  mod: HtmlToImageModule;
  calls: StubBindings;
} {
  const calls: StubBindings = {
    satoru_create_instance: vi.fn(() => ({ tag: "satoru" })),
    satoru_destroy_instance: vi.fn(),
    satoru_set_log_level: vi.fn(),
    satoru_collect_resources: vi.fn(),
    satoru_get_pending_resources: vi.fn(async () => null),
    satoru_add_resource: vi.fn(),
    satoru_set_font_map: vi.fn(),
    satoru_load_font: vi.fn(),
    satoru_load_fallback_font: vi.fn(),
    satoru_scan_css: vi.fn(),
    satoru_set_collect_profile_enabled: vi.fn(),
    satoru_get_collect_profile: vi.fn(async () => "{}"),
    satoru_render: vi.fn(async () => new Uint8Array([7, 7, 7])),
    html_to_image: vi.fn(async () => new Uint8Array([8, 8, 8])),
    converter_create_instance: vi.fn(() => ({ tag: "converter" })),
    converter_destroy_instance: vi.fn(),
    converter_load_image: vi.fn(() => true),
    converter_encode: vi.fn(async () => new Uint8Array([9, 9, 9])),
    ...overrides,
  };
  return { mod: calls as unknown as HtmlToImageModule, calls };
}

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

/** Single-entry pending-resources binary (font by default). */
const pendingBin = (url: string, type = 1): Uint8Array => {
  const ub = enc.encode(url);
  const nb = enc.encode("f");
  const parts = [u32(1), new Uint8Array([type, 0]), u32(ub.length), ub, u32(nb.length), nb, u32(0)];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const baseOptions = (extra?: Partial<HtmlToImageOptions>): HtmlToImageOptions => ({
  value: "<h1>hi</h1>",
  width: 800,
  height: 600,
  format: "png",
  ...extra,
});

describe("htmlToImage: diagnostics report shape", () => {
  it("delivers a satoru-compatible report via onDiagnostics", async () => {
    const { mod } = stubModule();
    let report: RenderDiagnostics | undefined;
    const out = await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    expect(out).toEqual(new Uint8Array([9, 9, 9]));
    expect(report).toBeDefined();
    const r = report as unknown as RenderDiagnostics;
    expect(r.version).toBe(1);
    expect(r.format).toBe("png");
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    expect(r.mediaType).toBe("screen");
    expect(typeof r.timings.total).toBe("number");
    expect(typeof r.timings.resolveResources).toBe("number");
    expect(typeof r.timings.render).toBe("number");
    expect(typeof r.timings.encode).toBe("number");
    expect(Array.isArray(r.resources)).toBe(true);
    expect(Array.isArray(r.fonts)).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(Array.isArray(r.errors)).toBe(true);
  });

  it("stays silent without diagnostics:true", async () => {
    const { mod } = stubModule();
    const onDiagnostics = vi.fn();
    await htmlToImage(mod, baseOptions({ onDiagnostics }));
    expect(onDiagnostics).not.toHaveBeenCalled();
  });
});

describe("htmlToImage: resolveResource hook", () => {
  it("routes discovery fetches through the hook and records them", async () => {
    const seen: string[] = [];
    const hook = vi.fn(async (url: string, fallback: () => Promise<Uint8Array | null>) => {
      seen.push(url);
      expect(typeof fallback).toBe("function");
      return new Uint8Array([5, 5]);
    });
    const { mod, calls } = stubModule({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(pendingBin("https://example.com/f.woff2") as never),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        resolveResource: hook,
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    expect(seen).toContain("https://example.com/f.woff2");
    expect(calls.satoru_add_resource).toHaveBeenCalledWith(
      { tag: "satoru" },
      "https://example.com/f.woff2",
      1,
      new Uint8Array([5, 5]),
    );
    const res = (report as unknown as RenderDiagnostics).resources;
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      type: "font",
      url: "https://example.com/f.woff2",
      status: "loaded",
      bytes: 2,
    });
  });

  it("skips injection and warns when the hook returns null", async () => {
    const { mod, calls } = stubModule({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(pendingBin("https://example.com/f.woff2") as never),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        resolveResource: async () => null,
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    expect(calls.satoru_add_resource).not.toHaveBeenCalled();
    const r = report as unknown as RenderDiagnostics;
    expect(r.resources[0].status).toBe("failed");
    expect(r.warnings.some((w) => w.code === DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED)).toBe(true);
  });
});

describe("htmlToImage: onLog gating", () => {
  it("calls onLog at stage boundaries when logLevel allows", async () => {
    const { mod } = stubModule();
    const onLog = vi.fn();
    await htmlToImage(mod, baseOptions({ logLevel: LogLevel.Info, onLog }));
    expect(onLog).toHaveBeenCalledWith(LogLevel.Info, expect.stringContaining("render start"));
    expect(onLog).toHaveBeenCalledWith(LogLevel.Info, expect.stringContaining("render done"));
    expect(mod.satoru_set_log_level).toHaveBeenCalledWith(LogLevel.Info);
  });

  it("stays silent at the default log level", async () => {
    const { mod } = stubModule();
    const onLog = vi.fn();
    await htmlToImage(mod, baseOptions({ onLog }));
    expect(onLog).not.toHaveBeenCalled();
  });
});

describe("htmlToImage: mediaType / textToPaths / css / fonts / limits / pdf", () => {
  it("wires print media, textToPaths, css, fonts, and pdf metadata", async () => {
    const { mod, calls } = stubModule();
    await htmlToImage(
      mod,
      baseOptions({
        mediaType: "print",
        textToPaths: false,
        css: "h1{color:red}",
        fonts: [{ name: "Pre", data: new Uint8Array([1]) }],
        pdfTitle: "T",
        pdfMargin: { top: 7 },
      }),
    );
    // collect 5th arg: print -> 1 (screen -> 0).
    expect(calls.satoru_collect_resources).toHaveBeenCalledWith(
      { tag: "satoru" },
      "<h1>hi</h1>",
      800,
      600,
      1,
    );
    expect(calls.satoru_scan_css).toHaveBeenCalledWith({ tag: "satoru" }, "h1{color:red}");
    expect(calls.satoru_load_font).toHaveBeenCalledWith(
      { tag: "satoru" },
      "Pre",
      new Uint8Array([1]),
    );
    const renderOpts = (calls.satoru_render.mock.calls[0] as unknown[])[5] as Record<
      string,
      unknown
    >;
    expect(renderOpts).toMatchObject({
      svgTextToPaths: false,
      mediaType: 1,
      pdfTitle: "T",
      pdfMarginTop: 7,
    });
  });

  it("blocks disallowed hosts and records LIMIT_HOST_BLOCKED", async () => {
    const { mod, calls } = stubModule({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(pendingBin("https://blocked.example/f.woff2") as never),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        limits: { blockedHosts: ["blocked.example"] },
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    expect(calls.satoru_add_resource).not.toHaveBeenCalled();
    const r = report as unknown as RenderDiagnostics;
    expect(r.resources[0].status).toBe("skipped");
    expect(
      r.errors.some((e) => e.code === DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED),
    ).toBe(true);
  });
});
