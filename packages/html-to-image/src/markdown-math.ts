import katex from "katex";
import { KATEX_CSS_VERSION, KATEX_FONT_FACES, KATEX_RULES } from "./katex-css.js";
import type { MathRenderer } from "./markdown-math-syntax.js";

export type { MathRenderer } from "./markdown-math-syntax.js";

export interface KatexMathOptions {
  /**
   * Where the KaTeX font files (`KaTeX_Main-Regular.woff2`, ...) are served from, without a trailing
   * slash. Defaults to the jsDelivr copy of the KaTeX version the stylesheet was taken from; point it
   * at your own host to render without a third-party request.
   */
  fontBase?: string;
  /** Passed to `katex.renderToString` (`output` and `displayMode` are set here). */
  katex?: Omit<katex.KatexOptions, "output" | "displayMode">;
}

/** Stylesheet for KaTeX HTML: its rules plus one woff2 `@font-face` per font, served from `fontBase`. */
export function katexCss(fontBase = `https://cdn.jsdelivr.net/npm/katex@${KATEX_CSS_VERSION}/dist/fonts`): string {
  const faces = KATEX_FONT_FACES.map(
    ([family, style, weight, file]) =>
      `@font-face{font-family:${family};font-style:${style};font-weight:${weight};src:url(${fontBase}/${file}) format("woff2")}`,
  ).join("");
  return faces + KATEX_RULES;
}

/**
 * KaTeX as the `math` option of `markdownToHtml`:
 *
 * ```ts
 * import { markdownToHtml } from "wasm-html-to-image/markdown";
 * import { katexMath } from "wasm-html-to-image/markdown-math";
 * const html = markdownToHtml("Euler: $e^{i\\pi} + 1 = 0$", { math: katexMath() });
 * ```
 *
 * Pure JavaScript (KaTeX's HTML output, not MathML), so it runs in Node, browsers and Workers. The fonts
 * are fetched by the renderer from `fontBase` when the page is drawn.
 */
export function katexMath(options: KatexMathOptions = {}): MathRenderer {
  return {
    render: (tex, display) =>
      katex.renderToString(tex, { throwOnError: true, ...options.katex, output: "html", displayMode: display }),
    css: katexCss(options.fontBase),
  };
}
