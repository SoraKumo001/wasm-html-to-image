import type { MarkedExtension, Tokens } from "marked";

/**
 * What `markdownToHtml` needs from a maths renderer. `markdown-math` provides one built on KaTeX; any
 * function that turns TeX into an HTML fragment works (the stylesheet it depends on goes in `css`).
 */
export interface MathRenderer {
  /** TeX to an HTML fragment. `display` is true for `$$...$$` blocks. */
  render(tex: string, display: boolean): string;
  /** Stylesheet the fragments need (appended after the built-in one). */
  css?: string;
}

interface MathToken extends Tokens.Generic {
  type: "math" | "math-inline";
  raw: string;
  text: string;
  display: boolean;
}

/**
 * `$...$` (inline) and `$$...$$` (block) for marked.
 *
 * Inline follows the pandoc rules so prices stay prices: the opening `$` is followed by a non-space,
 * the closing `$` is preceded by a non-space and is not followed by a digit, and `\$` is a literal
 * dollar. A block is `$$` on its own line up to the next line with `$$` (or one-line `$$ x $$`).
 * Code spans and fences never reach these tokenizers, so `$` inside them is left alone.
 */
export function mathExtension(math: MathRenderer): MarkedExtension {
  const fail = (tex: string, e: unknown) =>
    `<code class="math-error" title="${String(e).replace(/"/g, "&quot;")}">${tex.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code>`;
  const render = (tex: string, display: boolean) => {
    try {
      return math.render(tex, display);
    } catch (e) {
      return fail(tex, e);
    }
  };
  return {
    extensions: [
      {
        name: "math",
        level: "block",
        start: (src: string) => /(^|\n)\$\$/.exec(src)?.index,
        tokenizer(src: string): MathToken | undefined {
          const m = /^\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src) ?? /^\$\$([^\n]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
          if (!m) return undefined;
          return { type: "math", raw: m[0], text: m[1].trim(), display: true };
        },
        renderer(token: Tokens.Generic) {
          const t = token as MathToken;
          return `<div class="math-display">${render(t.text, true)}</div>\n`;
        },
      },
      {
        name: "math-inline",
        level: "inline",
        start: (src: string) => {
          const i = src.search(/(^|[^\\])\$/);
          return i < 0 ? undefined : src[i] === "$" ? i : i + 1;
        },
        tokenizer(src: string): MathToken | undefined {
          // $$x$$ inside a paragraph is display-style maths too.
          const dd = /^\$\$([^\n$]+?)\$\$/.exec(src);
          if (dd) return { type: "math-inline", raw: dd[0], text: dd[1].trim(), display: true };
          const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
          if (!m) return undefined;
          return { type: "math-inline", raw: m[0], text: m[1], display: false };
        },
        renderer(token: Tokens.Generic) {
          const t = token as MathToken;
          return render(t.text, t.display);
        },
      },
    ],
  };
}
