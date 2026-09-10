import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFullSatoruOptions,
  buildSatoruOptions,
  FIT_INT,
  FORMAT_INT,
} from "../src/encode-args.js";
import {
  imageBytesFromUnknown,
  isImageInput,
} from "../src/input.js";
import {
  checkResourceAllowed,
  fetchResourceBytes,
  limitCodeForReason,
  parsePendingResources,
} from "../src/core-resources.js";
import {
  createOrchestration,
  requireBindingError,
  resolveHtmlSource,
} from "../src/core-orchestrate.js";
import { DIAGNOSTIC_CODES } from "../src/diagnostics.js";
import type { HtmlToImageModule } from "../src/loader.js";

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

/** Multi-entry pending-resources binary. */
const pendingBin = (entries: { type: number; url: string }[]): Uint8Array => {
  const parts: Uint8Array[] = [u32(entries.length)];
  for (const e of entries) {
    const ub = enc.encode(e.url);
    parts.push(
      new Uint8Array([e.type, 0]),
      u32(ub.length),
      ub,
      u32(1),
      enc.encode("n"),
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const stubMod = {} as unknown as HtmlToImageModule;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("core-split: encode-args canonical builders", () => {
  it("exposes the WASM int enums", () => {
    expect(FORMAT_INT.png).toBe(1);
    expect(FORMAT_INT.webp).toBe(2);
    expect(FORMAT_INT.none).toBe(-1);
    expect(FIT_INT).toEqual({ contain: 0, cover: 1, fill: 2 });
  });

  it("buildSatoruOptions maps crop/fit only", () => {
    expect(buildSatoruOptions(undefined, undefined)).toEqual({});
    expect(
      buildSatoruOptions({ x: 1, y: 2, width: 100, height: 50 }, "cover"),
    ).toEqual({ cropX: 1, cropY: 2, cropWidth: 100, cropHeight: 50, fitType: 1 });
  });

  it("buildFullSatoruOptions defaults match the parity satoru opts", () => {
    expect(buildFullSatoruOptions({ crop: undefined, fit: undefined, mediaTypeInt: 0 })).toEqual({
      svgTextToPaths: true,
      mediaType: 0,
      pdfTitle: "",
      pdfAuthor: "",
      pdfSubject: "",
      pdfKeywords: "",
      pdfCreator: "",
      pdfProducer: "",
      pdfMarginTop: 0,
      pdfMarginRight: 0,
      pdfMarginBottom: 0,
      pdfMarginLeft: 0,
      pdfHeader: "",
      pdfFooter: "",
    });
  });

  it("buildFullSatoruOptions applies overrides", () => {
    expect(
      buildFullSatoruOptions({
        crop: { x: 1, y: 2, width: 3, height: 4 },
        fit: "fill",
        textToPaths: false,
        mediaTypeInt: 1,
        pdfTitle: "T",
        pdfMargin: { top: 7, left: 9 },
        pdfHeader: "H",
        pdfFooter: "F",
      }),
    ).toMatchObject({
      cropX: 1,
      cropY: 2,
      cropWidth: 3,
      cropHeight: 4,
      fitType: 2,
      svgTextToPaths: false,
      mediaType: 1,
      pdfTitle: "T",
      pdfMarginTop: 7,
      pdfMarginLeft: 9,
      pdfHeader: "H",
      pdfFooter: "F",
    });
  });
});

describe("core-split: imageBytesFromUnknown (isImageInput companion)", () => {
  it("normalizes bytes, buffers, and data URLs", () => {
    expect(isImageInput(PNG)).toBe(true);
    expect(imageBytesFromUnknown(PNG)).toBe(PNG);
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(imageBytesFromUnknown(buf)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    const out = imageBytesFromUnknown(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(out[0]).toBe(0x89);
  });

  it("throws the unsupported-type error for non-image shapes", () => {
    expect(() => imageBytesFromUnknown(42)).toThrow(/unsupported input type/);
    expect(() => imageBytesFromUnknown({})).toThrow(/unsupported input type/);
  });
});

describe("core-split: allow-list checks", () => {
  it("allows everything without limits and skips relative URLs", () => {
    expect(checkResourceAllowed("https://a.example/x", {})).toBeNull();
    expect(
      checkResourceAllowed("a.png", {
        allowedProtocols: ["https:"],
        blockedHosts: ["a.example"],
      }),
    ).toBeNull();
    expect(checkResourceAllowed("::not a url::", { blockedHosts: ["h"] })).toBeNull();
  });

  it("blocks disallowed protocols and hosts", () => {
    expect(
      checkResourceAllowed("http://a.example/x", { allowedProtocols: ["https:"] }),
    ).toBe("Protocol http: is blocked");
    expect(
      checkResourceAllowed("https://b.example/x", { allowedHosts: ["a.example"] }),
    ).toBe("Host b.example is not in allowed list");
    expect(
      checkResourceAllowed("https://evil.example/x", {
        blockedHosts: ["evil.example"],
      }),
    ).toBe("Host evil.example is blocked");
  });

  it("maps block reasons to codes", () => {
    expect(limitCodeForReason("Protocol http: is blocked")).toBe(
      DIAGNOSTIC_CODES.LIMIT_PROTOCOL_BLOCKED,
    );
    expect(limitCodeForReason("Host x is blocked")).toBe(
      DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED,
    );
  });
});

describe("core-split: parsePendingResources", () => {
  it("returns [] for empty input", () => {
    expect(parsePendingResources(null)).toEqual([]);
    expect(parsePendingResources(undefined)).toEqual([]);
    expect(parsePendingResources(new Uint8Array([]))).toEqual([]);
    expect(parsePendingResources(new Uint8Array([1, 2]))).toEqual([]);
  });

  it("decodes font/image/css entries", () => {
    const bin = pendingBin([
      { type: 1, url: "https://a.example/f.woff2" },
      { type: 2, url: "https://a.example/i.png" },
      { type: 3, url: "https://a.example/s.css" },
    ]);
    expect(parsePendingResources(bin)).toMatchObject([
      { type: "font", url: "https://a.example/f.woff2" },
      { type: "image", url: "https://a.example/i.png" },
      { type: "css", url: "https://a.example/s.css" },
    ]);
  });

  it("never throws on truncated binaries", () => {
    const full = pendingBin([{ type: 1, url: "https://a.example/f.woff2" }]);
    expect(parsePendingResources(full.slice(0, 6))).toEqual([]);
  });
});

describe("core-split: fetchResourceBytes", () => {
  it("skips data: URLs without touching fetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchResourceBytes("data:image/png;base64,AAA")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes through the hook and swallows hook throws", async () => {
    expect(
      await fetchResourceBytes("https://a.example/x", undefined, undefined, async () => new Uint8Array([9])),
    ).toEqual(new Uint8Array([9]));
    expect(
      await fetchResourceBytes("https://a.example/x", undefined, undefined, async () => null),
    ).toBeNull();
    expect(
      await fetchResourceBytes("https://a.example/x", undefined, undefined, async () => {
        throw new Error("hook broke");
      }),
    ).toBeNull();
  });

  it("returns null when fetch fails or throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    expect(await fetchResourceBytes("https://a.example/x")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net down");
      }),
    );
    expect(await fetchResourceBytes("https://a.example/x")).toBeNull();
  });
});

describe("core-split: orchestration basics", () => {
  it("requireBindingError names the missing binding", () => {
    expect(String(requireBindingError("satoru_render"))).toMatch(
      /binding "satoru_render" is required/,
    );
  });

  it("resolveHtmlSource passes value through (string and array)", async () => {
    const single = createOrchestration(stubMod, {
      value: "<h1>x</h1>",
      width: 10,
    });
    expect(await resolveHtmlSource(single)).toBe("<h1>x</h1>");
    const multi = createOrchestration(stubMod, {
      value: ["<h1>a</h1>", "<h1>b</h1>"],
      width: 10,
    });
    expect(await resolveHtmlSource(multi)).toEqual(["<h1>a</h1>", "<h1>b</h1>"]);
  });

  it("resolveHtmlSource fetches url text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "<p>u</p>" })),
    );
    const orch = createOrchestration(stubMod, {
      width: 10,
      url: "https://example.com/",
    });
    expect(await resolveHtmlSource(orch)).toBe("<p>u</p>");
  });

  it("resolveHtmlSource decodes hook bytes for url", async () => {
    const orch = createOrchestration(stubMod, {
      width: 10,
      url: "https://example.com/",
      resolveResource: async () => new TextEncoder().encode("<p>h</p>"),
    });
    expect(await resolveHtmlSource(orch)).toBe("<p>h</p>");
  });

  it("resolveHtmlSource throws when fetch fails, hook is null, or nothing given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const bad = createOrchestration(stubMod, {
      width: 10,
      url: "https://example.com/",
    });
    await expect(resolveHtmlSource(bad)).rejects.toThrow(/failed to fetch/);

    const nullHook = createOrchestration(stubMod, {
      width: 10,
      url: "https://example.com/",
      resolveResource: async () => null,
    });
    await expect(resolveHtmlSource(nullHook)).rejects.toThrow(
      /failed to fetch HTML from URL/,
    );

    const empty = createOrchestration(stubMod, { width: 10 });
    await expect(resolveHtmlSource(empty)).rejects.toThrow(
      /either 'value' or 'url'/,
    );
  });
});
