import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FETCH_CONCURRENCY,
  fetchResourceBytes,
  mapWithLimit,
  resolveHtmlResources,
  type ResolveContext,
} from "../src/core-resources.js";
import { LogLevel, type RenderLimits } from "../src/diagnostics.js";
import type { HtmlToImageModule } from "../src/loader.js";

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

/** Pending-resources binary: all fonts, name "n". */
function pendingBin(urls: string[]): Uint8Array {
  const parts: Uint8Array[] = [u32(urls.length)];
  for (const url of urls) {
    const ub = enc.encode(url);
    parts.push(
      new Uint8Array([1, 0]),
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
): Promise<string[]> {
  const added: string[] = [];
  let served = false;
  const module = {
    satoru_collect_resources: () => undefined,
    satoru_get_pending_resources: () => {
      if (served) return new Uint8Array(0);
      served = true;
      return pendingBin(urls);
    },
    satoru_add_resource: (_i: unknown, url: string) => {
      added.push(url);
    },
  } as unknown as HtmlToImageModule;
  const ctx: ResolveContext = {
    mediaTypeInt: 0,
    limits,
    diag: null,
    usage: { resourceCount: 0, totalResourceBytes: 0 },
    t0: performance.now(),
    emitLog: (_l: LogLevel, _m: string) => undefined,
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

afterEach(() => vi.unstubAllGlobals());

describe("limits are enforced without diagnostics", () => {
  it("maxResourceCount caps parallel fetches", async () => {
    const added = await discover(uniqueUrls(5), { maxResourceCount: 2 }, 4);
    expect(added).toHaveLength(2);
  });

  it("maxTotalResourceBytes caps the accumulated size", async () => {
    const added = await discover(
      uniqueUrls(5),
      { maxTotalResourceBytes: 25 },
      10,
    );
    expect(added).toHaveLength(2);
  });

  it("releases the reserved slot when a fetch fails", async () => {
    const urls = uniqueUrls(1);
    let served = false;
    const module = {
      satoru_collect_resources: () => undefined,
      satoru_get_pending_resources: () => {
        if (served) return new Uint8Array(0);
        served = true;
        return pendingBin(urls);
      },
      satoru_add_resource: () => undefined,
    } as unknown as HtmlToImageModule;
    const ctx: ResolveContext = {
      mediaTypeInt: 0,
      limits: { maxResourceCount: 1 },
      diag: null,
      usage: { resourceCount: 0, totalResourceBytes: 0 },
      t0: performance.now(),
      emitLog: () => undefined,
      addTime: () => undefined,
      checkTimeout: () => undefined,
      resolveResource: async () => null,
    };
    await resolveHtmlResources(
      module, {}, "<p/>", 100, undefined, undefined, undefined, undefined, undefined, ctx,
    );
    expect(ctx.usage.resourceCount).toBe(0);
  });
});

describe("per-fetch timeout", () => {
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

  it("passes no signal when timeoutMs is unset", async () => {
    let init: { signal?: AbortSignal } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, i?: { signal?: AbortSignal }) => {
        init = i;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
      }),
    );
    await fetchResourceBytes("https://nosignal.example/x");
    expect(init?.signal).toBeUndefined();
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
    usage: { resourceCount: 0, totalResourceBytes: 0 },
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

  it("fetches every page's resources in parallel, capped at FETCH_CONCURRENCY", async () => {
    let live = 0;
    let peak = 0;
    const total = FETCH_CONCURRENCY * 3;
    const { module } = pagedModule([uniqueUrls(total), []]);
    await resolveHtmlResources(
      module, {}, ["<p/>", "<p/>"], 100, undefined, undefined, undefined, undefined, undefined,
      baseCtx(async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return new Uint8Array(1);
      }),
    );
    expect(peak).toBe(FETCH_CONCURRENCY);
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

  it("handles an empty list", async () => {
    await expect(mapWithLimit([], 4, async () => undefined)).resolves.toBeUndefined();
  });
});
