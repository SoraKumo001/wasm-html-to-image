import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchResourceBytes,
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
