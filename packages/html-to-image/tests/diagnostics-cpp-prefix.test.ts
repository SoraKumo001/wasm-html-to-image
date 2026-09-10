import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_CODES,
  htmlToImage,
  LogLevel,
  type HtmlToImageOptions,
  type RenderDiagnostics,
} from "../src/core.js";
// NOTE: parse helpers live in diagnostics.js (not re-exported via core.js).
import {
  CPP_LOG_PREFIX_RE,
  errorToDiagnostic,
  parseBracketPrefix,
  parseCppLogToDiagnostic,
} from "../src/diagnostics.js";
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

const pendingBin = (url: string, type = 1): Uint8Array => {
  const ub = enc.encode(url);
  const nb = enc.encode("f");
  const parts = [
    u32(1),
    new Uint8Array([type, 0]),
    u32(ub.length),
    ub,
    u32(nb.length),
    nb,
    u32(0),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const baseOptions = (
  extra?: Partial<HtmlToImageOptions>,
): HtmlToImageOptions => ({
  value: "<h1>hi</h1>",
  width: 800,
  height: 600,
  format: "png",
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("diagnostics: new C++ CODE family", () => {
  it("exposes the five C++ prefix codes", () => {
    expect(DIAGNOSTIC_CODES.MAGIC_COLOR_PARSE_FAILED).toBe(
      "MAGIC_COLOR_PARSE_FAILED",
    );
    expect(DIAGNOSTIC_CODES.FONT_UNICODE_RANGE_PARSE_FAILED).toBe(
      "FONT_UNICODE_RANGE_PARSE_FAILED",
    );
    expect(DIAGNOSTIC_CODES.COLLECT_RESOURCES_FAILED).toBe(
      "COLLECT_RESOURCES_FAILED",
    );
    expect(DIAGNOSTIC_CODES.JS_LOG_FORWARD_FAILED).toBe(
      "JS_LOG_FORWARD_FAILED",
    );
    expect(DIAGNOSTIC_CODES.PDF_MERGE_FAILED).toBe("PDF_MERGE_FAILED");
  });

  it("keeps the pre-existing codes intact", () => {
    expect(DIAGNOSTIC_CODES.LIMIT_TIMEOUT).toBe("LIMIT_TIMEOUT");
    expect(DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED).toBe(
      "RESOURCE_FETCH_FAILED",
    );
  });

  it("matches the documented [CODE] shape", () => {
    expect("[MAGIC_COLOR_PARSE_FAILED] bad color").toMatch(
      CPP_LOG_PREFIX_RE,
    );
    expect("plain message").not.toMatch(CPP_LOG_PREFIX_RE);
  });
});

describe("diagnostics: parseBracketPrefix", () => {
  it("splits [CODE] detail", () => {
    expect(parseBracketPrefix("[PDF_MERGE_FAILED] boom")).toEqual({
      code: "PDF_MERGE_FAILED",
      message: "boom",
    });
  });

  it("tolerates missing detail and missing space", () => {
    expect(parseBracketPrefix("[COLLECT_RESOURCES_FAILED]")).toEqual({
      code: "COLLECT_RESOURCES_FAILED",
      message: "",
    });
    expect(parseBracketPrefix("[JS_LOG_FORWARD_FAILED]oops")).toEqual({
      code: "JS_LOG_FORWARD_FAILED",
      message: "oops",
    });
  });

  it("returns null without a prefix", () => {
    expect(parseBracketPrefix("boom")).toBeNull();
    expect(parseBracketPrefix("")).toBeNull();
    expect(parseBracketPrefix("[lower] x")).toBeNull();
    expect(parseBracketPrefix(" [PDF_MERGE_FAILED] x")).toBeNull();
  });
});

describe("diagnostics: parseCppLogToDiagnostic / errorToDiagnostic", () => {
  it("keeps the parsed code and strips the prefix", () => {
    expect(
      parseCppLogToDiagnostic(
        "[FONT_UNICODE_RANGE_PARSE_FAILED] skip it",
        "FALLBACK",
        "src",
      ),
    ).toEqual({
      code: "FONT_UNICODE_RANGE_PARSE_FAILED",
      message: "skip it",
      source: "src",
    });
    expect(parseCppLogToDiagnostic("[PDF_MERGE_FAILED] m", "FALLBACK")).toEqual({
      code: "PDF_MERGE_FAILED",
      message: "m",
      source: undefined,
    });
  });

  it("falls back with raw text intact when no prefix", () => {
    expect(parseCppLogToDiagnostic("plain", "FALLBACK", "s")).toEqual({
      code: "FALLBACK",
      message: "plain",
      source: "s",
    });
  });

  it("normalizes Error objects preserving prefixes", () => {
    expect(
      errorToDiagnostic(
        new Error("[MAGIC_COLOR_PARSE_FAILED] bad '#zzz'"),
        DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
        "u",
      ),
    ).toEqual({
      code: "MAGIC_COLOR_PARSE_FAILED",
      message: "bad '#zzz'",
      source: "u",
    });
    expect(
      errorToDiagnostic(
        new Error("plain fail"),
        DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
        "u",
      ),
    ).toEqual({
      code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
      message: "plain fail",
      source: "u",
    });
  });

  it("normalizes non-Error values via String()", () => {
    expect(
      errorToDiagnostic(
        "[COLLECT_RESOURCES_FAILED] crashed",
        DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
      ),
    ).toMatchObject({ code: "COLLECT_RESOURCES_FAILED" });
    expect(errorToDiagnostic(42, "FALLBACK")).toMatchObject({
      code: "FALLBACK",
      message: "42",
    });
  });
});

describe("diagnostics: C++ prefix flows through resource warnings", () => {
  it("records the parsed code when font preload throws a prefixed error", async () => {
    const { mod } = stubModule({
      satoru_load_font: vi.fn(async () => {
        throw new Error("[FONT_UNICODE_RANGE_PARSE_FAILED] skip segment 'x'");
      }),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        fonts: [{ name: "Pre", data: new Uint8Array([1]) }],
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    const warnings = (report as unknown as RenderDiagnostics).warnings;
    expect(
      warnings.some(
        (w) =>
          w.code === "FONT_UNICODE_RANGE_PARSE_FAILED" &&
          w.source === "Pre",
      ),
    ).toBe(true);
  });

  it("records the parsed code when css pre-scan throws a prefixed error", async () => {
    const { mod } = stubModule({
      satoru_scan_css: vi.fn(async () => {
        throw new Error("[COLLECT_RESOURCES_FAILED] scan broke");
      }),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        css: "h1{color:red}",
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    const warnings = (report as unknown as RenderDiagnostics).warnings;
    expect(
      warnings.some((w) => w.code === "COLLECT_RESOURCES_FAILED"),
    ).toBe(true);
  });

  it("records the parsed code when add_resource throws a prefixed error", async () => {
    const { mod } = stubModule({
      satoru_get_pending_resources: vi
        .fn(async () => null)
        .mockResolvedValueOnce(
          pendingBin("https://example.com/a.jpg", 2) as never,
        ),
      satoru_add_resource: vi.fn(async () => {
        throw new Error("[PDF_MERGE_FAILED] inject broke");
      }),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        resolveResource: async () => new Uint8Array([1, 2]),
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    const r = report as unknown as RenderDiagnostics;
    expect(r.resources[0].status).toBe("failed");
    expect(
      r.warnings.some((w) => w.code === "PDF_MERGE_FAILED"),
    ).toBe(true);
  });

  it("keeps the fallback code for non-prefixed resource errors", async () => {
    const { mod } = stubModule({
      satoru_load_font: vi.fn(async () => {
        throw new Error("plain load fail");
      }),
    });
    let report: RenderDiagnostics | undefined;
    await htmlToImage(
      mod,
      baseOptions({
        diagnostics: true,
        fonts: [{ name: "Pre", data: new Uint8Array([1]) }],
        onDiagnostics: (r) => {
          report = r;
        },
      }),
    );
    const warnings = (report as unknown as RenderDiagnostics).warnings;
    expect(
      warnings.some(
        (w) =>
          w.code === DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED &&
          w.message === "plain load fail",
      ),
    ).toBe(true);
  });

  it("touches LogLevel to keep the diagnostics surface linked", () => {
    expect(LogLevel.Warning).toBe(2);
  });
});
