import { afterEach, describe, expect, it, vi } from "vitest";
import { clearResourceCache, type ResolveContext } from "../src/core-resources.js";
import { inlineExternalSvgSprites } from "../src/svg-sprites.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearResourceCache();
});

const makeCtx = (
  resolveResource?: ResolveContext["resolveResource"],
): ResolveContext => ({
  mediaTypeInt: 0,
  limits: {},
  diag: null,
  usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
  t0: performance.now(),
  emitLog: () => undefined,
  addTime: () => undefined,
  checkTimeout: () => undefined,
  resolveResource,
});

describe("inlineExternalSvgSprites", () => {
  it("returns input untouched when there are no external <use> references", async () => {
    const html = '<svg><defs><g id="a"/></defs><use href="#a"/></svg>';
    const spy = vi.fn(async () => null);
    const out = await inlineExternalSvgSprites(html, undefined, undefined, makeCtx(spy));
    expect(out).toBe(html);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches external sprites, injects <defs>, rewrites href/xlink:href, and strips <script>", async () => {
    const sprite =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      "<script>alert(1)</script>" +
      '<symbol id="star" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></symbol>' +
      '<g id="dot"><circle cx="5" cy="5" r="5"/></g>' +
      "</svg>";
    const html =
      '<div>' +
      '<svg width="24" height="24"><use href="/icons.svg#star"/></svg>' +
      '<svg width="10" height="10"><use xlink:href="/icons.svg#dot"/></svg>' +
      "</div>";

    const fetched: string[] = [];
    const out = (await inlineExternalSvgSprites(
      html,
      "https://site.example/page.html",
      undefined,
      makeCtx(async (url) => {
        fetched.push(url);
        return new TextEncoder().encode(sprite);
      }),
    )) as string;

    expect(fetched).toEqual(["/icons.svg"]);
    expect(out).not.toContain("<script>");
    expect(out).toContain('<use href="#star"/>');
    expect(out).toContain('<use xlink:href="#dot"/>');
    expect(out).toContain('<defs><symbol id="star"');
    expect(out).toContain('<g id="dot">');
  });

  it("respects limits when resolving sprite URLs", async () => {
    const html = '<svg><use href="https://blocked.example/s.svg#a"/></svg>';
    const ctx = makeCtx(async () => new TextEncoder().encode('<svg><g id="a"/></svg>'));
    ctx.limits = { blockedHosts: ["blocked.example"] };
    const out = await inlineExternalSvgSprites(html, undefined, undefined, ctx);
    expect(out).toBe(html);
  });
});
