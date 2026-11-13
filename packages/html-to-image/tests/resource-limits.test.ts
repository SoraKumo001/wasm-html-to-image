import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearResourceCache,
  FETCH_CONCURRENCY_PER_HOST,
  fetchResourceBytes,
  isPrivateHost,
  mapWithHostLimit,
  mapWithLimit,
  resolveHtmlResources,
  type FallbackFontEntry,
  type ResolveContext,
} from "../src/core-resources.js";
import { DIAGNOSTIC_CODES, type RenderLimits } from "../src/diagnostics.js";
import type { HtmlToImageModule } from "../src/loader.js";

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

/** Pending-resources binary, name "n"; fonts unless `types` says otherwise (1 font, 2 image, 3 css). */
function pendingBin(urls: string[], types?: number[]): Uint8Array {
  const parts: Uint8Array[] = [u32(urls.length)];
  for (const [i, url] of urls.entries()) {
    const ub = enc.encode(url);
    parts.push(
      new Uint8Array([types?.[i] ?? 1, 0]),
      u32(ub.length),
      ub,
      u32(1),
      enc.encode("n"),
      u32(0),
    );
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

let seq = 0;
const uniqueUrls = (n: number): string[] => {
  const id = seq++;
  return Array.from({ length: n }, (_, i) => `https://r${id}.example/${i}.woff2`);
};

/** Run discovery with `diagnostics` OFF (diag === null) and return the adds. */
async function discover(
  urls: string[],
  limits: RenderLimits,
  bytesPerResource: number,
  types?: number[],
  logs: string[] = [],
): Promise<string[]> {
  const added: string[] = [];
  let served = false;
  const module = {
    satoru_collect_resources: () => undefined,
    satoru_get_pending_resources: () => {
      if (served) return new Uint8Array(0);
      served = true;
      return pendingBin(urls, types);
    },
    satoru_add_resource: (_i: unknown, url: string) => {
      added.push(url);
    },
  } as unknown as HtmlToImageModule;
  const ctx: ResolveContext = {
    mediaTypeInt: 0,
    limits,
    diag: null,
    usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
    t0: performance.now(),
    emitLog: (_l, m) => void logs.push(m),
    addTime: () => undefined,
    checkTimeout: () => undefined,
    resolveResource: async () => new Uint8Array(bytesPerResource),
  };
  await resolveHtmlResources(
    module,
    {},
    "<p>x</p>",
    100,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    ctx,
  );
  return added;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearResourceCache();
});

describe("limits are enforced without diagnostics", () => {
  it("maxResourceCount caps parallel fetches", async () => {
    const added = await discover(uniqueUrls(5), { maxResourceCount: 2 }, 4);
    expect(added).toHaveLength(2);
  });
});

describe("what maxResourceCount drops", () => {
  it("keeps fonts over images when the count cuts a round short", async () => {
    const [i1, i2, f1, f2] = uniqueUrls(4);
    // images are discovered first, fonts last
    const added = await discover([i1, i2, f1, f2], { maxResourceCount: 2 }, 4, [2, 2, 1, 1]);
    expect(added.sort()).toEqual([f1, f2].sort());
  });
  it("reports skipped fonts once, and strictFonts turns that into an error", async () => {
    const [f1, f2, f3] = uniqueUrls(3);
    const logs: string[] = [];
    await discover([f1, f2, f3], { maxResourceCount: 1 }, 4, [1, 1, 1], logs);
    expect(logs.filter((m) => m.includes("font file(s) were not loaded"))).toHaveLength(1);
    await expect(
      discover([f1, f2, f3], { maxResourceCount: 1, strictFonts: true }, 4, [1, 1, 1]),
    ).rejects.toThrow(/LIMIT_RESOURCE_COUNT/);
  });
});

describe("per-fetch timeout", () => {
  it("accepts a fractional remaining budget (Node >= 24 requires an integer delay)", async () => {
    let delay: number | undefined;
    const real = AbortSignal.timeout;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      delay = ms;
      return real.call(AbortSignal, Math.ceil(ms));
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(1))));
    await fetchResourceBytes("https://frac.example/x", undefined, undefined, undefined, 59948.93);
    expect(Number.isInteger(delay)).toBe(true);
  });

  it("aborts a hung fetch once timeoutMs elapses", async () => {
    let received: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            received = init?.signal;
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    );
    const bytes = await fetchResourceBytes(
      "https://hung.example/x",
      undefined,
      undefined,
      undefined,
      30,
    );
    expect(bytes).toBeNull();
    expect(received?.aborted).toBe(true);
  });
});

describe("multi-page discovery", () => {
  /** Module whose collect binding records its calls and reports pending per round. */
  function pagedModule(pendingRounds: string[][]) {
    const collectCalls: unknown[] = [];
    let round = 0;
    const module = {
      satoru_collect_resources: (_i: unknown, html: unknown) => {
        collectCalls.push(html);
      },
      satoru_get_pending_resources: () => {
        const urls = pendingRounds[round++] ?? [];
        return urls.length ? pendingBin(urls) : new Uint8Array(0);
      },
      satoru_add_resource: () => undefined,
    } as unknown as HtmlToImageModule;
    return { module, collectCalls };
  }

  const baseCtx = (resolve: ResolveContext["resolveResource"]): ResolveContext => ({
    mediaTypeInt: 0,
    limits: {},
    diag: null,
    usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
    t0: performance.now(),
    emitLog: () => undefined,
    addTime: () => undefined,
    checkTimeout: () => undefined,
    resolveResource: resolve,
  });

  it("collects all pages in a single call per round", async () => {
    const pages = ["<p>1</p>", "<p>2</p>", "<p>3</p>"];
    const { module, collectCalls } = pagedModule([uniqueUrls(4), []]);
    await resolveHtmlResources(
      module, {}, pages, 100, undefined, undefined, undefined, undefined, undefined,
      baseCtx(async () => new Uint8Array(1)),
    );
    // round 1 found resources, round 2 found none -> two collect calls, each with ALL pages
    expect(collectCalls).toEqual([pages, pages]);
  });
});

describe("mapWithLimit", () => {
  it("runs every item once and never exceeds the limit", async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      live--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
});

describe("workerd response body cancellation and streaming limits", () => {
  it("cancels response body when !res.ok", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        body: { cancel },
      })),
    );
    const bytes = await fetchResourceBytes("https://cancel.example/404");
    expect(bytes).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels stream and records LIMIT_RESOURCE_SIZE when chunks exceed maxResourceBytes", async () => {
    const readerCancel = vi.fn(async () => undefined);
    let reads = 0;
    const stream = {
      getReader: () => ({
        read: async () => {
          reads++;
          if (reads <= 3) return { done: false, value: new Uint8Array(6) };
          return { done: true, value: undefined };
        },
        cancel: readerCancel,
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: stream,
      })),
    );
    const errors: { code: string; message: string }[] = [];
    const bytes = await fetchResourceBytes(
      "https://stream.example/big.png",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxResourceBytes: 10 },
      (code, message) => errors.push({ code, message }),
    );
    expect(bytes).toBeNull();
    expect(readerCancel).toHaveBeenCalledTimes(1);
    expect(reads).toBe(2); // stopped on second 6-byte chunk (12 > 10)
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE);
  });
});

describe("redirect hop checks and blockPrivateHosts", () => {
  it("identifies private and loopback hosts", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("sub.localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.0.0.5")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("[::ffff:7f00:1]")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });

  it("blocks redirect hops to blocked or private hosts", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://public.example/start") {
          return {
            ok: false,
            status: 302,
            type: "basic",
            headers: new Headers({ location: "http://127.0.0.1/secret" }),
            body: { cancel },
          };
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const errors: { code: string; message: string }[] = [];
    const bytes = await fetchResourceBytes(
      "https://public.example/start",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { blockPrivateHosts: true },
      (code, message) => errors.push({ code, message }),
    );
    expect(bytes).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(errors[0]?.code).toBe(DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED);
  });
});

describe("mapWithHostLimit", () => {
  it("bounds per-host concurrency while allowing higher global concurrency across hosts", async () => {
    const livePerHost = new Map<string, number>();
    const peakPerHost = new Map<string, number>();
    let liveGlobal = 0;
    let peakGlobal = 0;
    const items = [
      ...Array.from({ length: 10 }, (_, i) => `a:${i}`),
      ...Array.from({ length: 10 }, (_, i) => `b:${i}`),
    ];
    await mapWithHostLimit(
      items,
      16,
      FETCH_CONCURRENCY_PER_HOST,
      (x) => x.split(":")[0],
      async (x) => {
        const host = x.split(":")[0];
        liveGlobal++;
        peakGlobal = Math.max(peakGlobal, liveGlobal);
        const h = (livePerHost.get(host) ?? 0) + 1;
        livePerHost.set(host, h);
        peakPerHost.set(host, Math.max(peakPerHost.get(host) ?? 0, h));
        await new Promise((r) => setTimeout(r, 10));
        livePerHost.set(host, (livePerHost.get(host) ?? 1) - 1);
        liveGlobal--;
      },
    );
    expect(peakPerHost.get("a")).toBe(FETCH_CONCURRENCY_PER_HOST);
    expect(peakPerHost.get("b")).toBe(FETCH_CONCURRENCY_PER_HOST);
    expect(peakGlobal).toBe(FETCH_CONCURRENCY_PER_HOST * 2);
  });
});

describe("on-demand fallbackFonts unicodeRange filtering", () => {
  const runFallbacks = async (
    html: string,
    fallbackFonts: FallbackFontEntry[],
  ): Promise<string[]> => {
    const fetched: string[] = [];
    const loaded: number[] = [];
    const module = {
      satoru_load_fallback_font: (_inst: unknown, bytes: Uint8Array) => {
        loaded.push(bytes.length);
      },
      satoru_collect_resources: () => undefined,
      satoru_get_pending_resources: () => new Uint8Array(0),
      satoru_add_resource: () => undefined,
    } as unknown as HtmlToImageModule;
    const ctx: ResolveContext = {
      mediaTypeInt: 0,
      limits: {},
      diag: null,
      usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
      t0: performance.now(),
      emitLog: () => undefined,
      addTime: () => undefined,
      checkTimeout: () => undefined,
      resolveResource: async (url) => {
        fetched.push(url);
        return new Uint8Array([1, 2, 3]);
      },
    };
    await resolveHtmlResources(
      module,
      {},
      html,
      800,
      undefined,
      undefined,
      undefined,
      undefined,
      fallbackFonts,
      ctx,
    );
    return fetched;
  };

  it("skips CJK/emoji fallbacks on ASCII HTML and loads when characters or entities match", async () => {
    const fonts: FallbackFontEntry[] = [
      { source: "https://fonts.example/cjk.woff2", unicodeRange: "cjk" },
      { source: "https://fonts.example/emoji.woff2", unicodeRange: "emoji" },
      { source: "https://fonts.example/greek.woff2", unicodeRange: /[\u0370-\u03FF]/ },
      "https://fonts.example/always.woff2",
    ];

    expect(await runFallbacks("<p>Hello world</p>", fonts)).toEqual([
      "https://fonts.example/always.woff2",
    ]);

    expect(await runFallbacks("<p>こんにちは 🚀</p>", fonts)).toEqual([
      "https://fonts.example/cjk.woff2",
      "https://fonts.example/emoji.woff2",
      "https://fonts.example/always.woff2",
    ]);

    // Numeric character references are decoded before matching
    expect(await runFallbacks("<p>&#x3042; &#945;</p>", fonts)).toEqual([
      "https://fonts.example/cjk.woff2",
      "https://fonts.example/greek.woff2",
      "https://fonts.example/always.woff2",
    ]);
  });
});
