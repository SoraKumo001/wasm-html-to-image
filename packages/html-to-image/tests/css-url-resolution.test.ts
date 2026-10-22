import { describe, expect, it } from "vitest";
import { absolutizeCssUrls } from "../src/core-resources.js";

describe("absolutizeCssUrls", () => {
  it("resolves relative url() against an absolute stylesheet URL", () => {
    const css = `@font-face{src:url("../fonts/a.woff") format("woff"),url(b.ttf)}`;
    expect(absolutizeCssUrls(css, "https://example.com/static/css/site.css")).toBe(
      `@font-face{src:url("https://example.com/static/fonts/a.woff") format("woff"),url(https://example.com/static/css/b.ttf)}`,
    );
  });

  it("leaves absolute, data:, protocol-relative, root-relative and fragment references alone", () => {
    const css =
      `.a{background:url(https://cdn.example/x.png)}.b{background:url(data:image/png;base64,AAAA)}` +
      `.c{background:url(//cdn.example/y.png)}.d{background:url(/abs/z.png)}.e{fill:url(#grad)}`;
    expect(absolutizeCssUrls(css, "https://example.com/static/site.css")).toBe(css);
  });
});
