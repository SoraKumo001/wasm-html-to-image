import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_CODES,
  htmlToImage,
  type HtmlToImageOptions,
  type RenderDiagnostics,
} from "../src/core.js";
// NOTE: parse helpers live in diagnostics.js (not re-exported via core.js).
import {
  errorToDiagnostic,
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

describe("diagnostics: C++ prefixed errors", () => {
  it("parses the prefixed code and strips the prefix", () => {
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
});

describe("diagnostics: C++ prefix survives the font preload flow", () => {
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
});
