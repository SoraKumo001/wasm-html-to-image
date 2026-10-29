import { afterEach, describe, expect, it, vi } from "vitest";
import { canSetUserAgent, clearResourceCache, fetchResourceBytes } from "../src/core-resources";

afterEach(() => {
  vi.unstubAllGlobals();
  clearResourceCache();
});

/**
 * Google Fonts picks the font format from the User-Agent: a browser UA gets woff2 split by
 * unicode-range, anything else (a Worker's own UA, none) the whole .ttf per weight, which a PDF then
 * embeds in full (about 3 MB for one heading). Node always sent the browser UA; Workers can set the
 * header too, but were only given the chance when the runtime looked like Node.
 */
describe("canSetUserAgent", () => {
  it("is true on Node", () => {
    expect(canSetUserAgent()).toBe(true);
  });

  it("is true in Cloudflare Workers (no process, navigator.userAgent is Cloudflare-Workers)", () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(canSetUserAgent()).toBe(true);
  });

  it("is false in a browser, where fetch forbids the header (and Firefox preflights it)", () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" });
    expect(canSetUserAgent()).toBe(false);
  });
});

describe("fetchResourceBytes User-Agent", () => {
  const seen = () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", f);
    return f;
  };
  const headerOf = (f: ReturnType<typeof seen>) => (f.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;

  it("sends the requested User-Agent in Workers", async () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const f = seen();
    await fetchResourceBytes("https://fonts.example/css", undefined, "Mozilla/5.0 Chrome/124");
    expect(headerOf(f)["User-Agent"]).toBe("Mozilla/5.0 Chrome/124");
  });

  it("sends none in a browser", async () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/130.0" });
    const f = seen();
    await fetchResourceBytes("https://fonts.example/css", undefined, "Mozilla/5.0 Chrome/124");
    expect(headerOf(f)["User-Agent"]).toBeUndefined();
  });
});
