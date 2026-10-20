import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetUno from "@unocss/preset-wind4";

/** Options shared by {@link createCSS}, {@link tailwind} and {@link convertTw}. */
export interface TailwindOptions {
  /**
   * Extra stylesheet that may use Tailwind v4 `@theme { ... }` and `@apply`.
   * It is converted like the `<style>` blocks of the HTML and appended to the result.
   */
  css?: string;
  /** Called for problems that are skipped (unknown / unsupported `@apply` utilities). Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

const warnDefault = (message: string) => console.warn(message);

// --- tw prop -> class ------------------------------------------------------

const PROTECTED_BLOCKS =
  /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const OPEN_TAG =
  /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*(\/?)>/g;
const ATTR =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g;

const escapeAttr = (value: string) => value.replace(/"/g, "&quot;");

/**
 * Rewrite Tailwind v4 style `tw="..."` attributes into `class` (merged with an existing `class`).
 * Comments, `<script>` and `<style>` contents are left untouched.
 */
export const convertTw = (html: string): string => {
  const protectedParts: string[] = [];
  const masked = html.replace(PROTECTED_BLOCKS, (block) => {
    protectedParts.push(block);
    return `\u0000${protectedParts.length - 1}\u0000`;
  });
  const converted = masked.replace(
    OPEN_TAG,
    (whole, name: string, attrs: string, selfClose: string) => {
      if (!/\stw\b/i.test(attrs)) return whole;
      let twValue = "";
      let classValue: string | undefined;
      const kept: string[] = [];
      for (const m of attrs.matchAll(ATTR)) {
        const attrName = m[1];
        const value = m[2] ?? m[3] ?? m[4] ?? "";
        const lower = attrName.toLowerCase();
        if (lower === "tw") {
          twValue = `${twValue} ${value}`.trim();
        } else if (lower === "class") {
          classValue = `${classValue ?? ""} ${value}`.trim();
        } else {
          kept.push(m[0]);
        }
      }
      if (!twValue) return whole;
      const merged = `${classValue ?? ""} ${twValue}`.trim();
      const rest = kept.length ? ` ${kept.join(" ")}` : "";
      return `<${name}${rest} class="${escapeAttr(merged)}"${selfClose ? " /" : ""}>`;
    },
  );
  return converted.replace(
    /\u0000(\d+)\u0000/g,
    (_, i: string) => protectedParts[Number(i)],
  );
};

// --- @theme / @apply -------------------------------------------------------

/** Index of the `}` matching the `{` at `open`, or -1. */
const matchBrace = (css: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
};

interface ThemeResult {
  css: string;
  variables: Record<string, string>;
}

/** Replace every `@theme { --x: v }` block by a `:root` rule carrying the same variables. */
const extractTheme = (css: string): ThemeResult => {
  const variables: Record<string, string> = {};
  let out = "";
  let pos = 0;
  const re = /@theme\b[^{;]*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(css, open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    const decls: string[] = [];
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
      variables[d[1]] = d[2].trim();
      decls.push(`${d[1]}:${d[2].trim()}`);
    }
    out += css.slice(pos, m.index);
    out += decls.length ? `:root{${decls.join(";")}}` : "";
    pos = close + 1;
    re.lastIndex = pos;
  }
  return { css: out + css.slice(pos), variables };
};

type ColorTree = { [name: string]: string | ColorTree };

/** `--color-brand-500` style theme variables as a UnoCSS `theme.colors` tree. */
const themeColors = (variables: Record<string, string>): ColorTree => {
  const colors: ColorTree = {};
  for (const [key, value] of Object.entries(variables)) {
    const m = /^--color-([\w-]+)$/.exec(key);
    if (!m) continue;
    const parts = m[1].split("-");
    let node = colors;
    for (const [i, part] of parts.entries()) {
      const existing = node[part];
      if (i === parts.length - 1) {
        // `--color-brand` and `--color-brand-500` coexist as brand.DEFAULT + brand[500].
        if (existing && typeof existing === "object") existing.DEFAULT = value;
        else node[part] = value;
      } else if (existing && typeof existing === "object") {
        node = existing;
      } else {
        const next: ColorTree =
          typeof existing === "string" ? { DEFAULT: existing } : {};
        node[part] = next;
        node = next;
      }
    }
  }
  return colors;
};

const APPLY = /@apply\s+([^;}]+?)\s*(;|(?=}))/g;

const applyTokens = (css: string): string[] => {
  const tokens: string[] = [];
  for (const m of css.matchAll(APPLY)) tokens.push(...m[1].split(/\s+/));
  return tokens.filter(Boolean);
};

const expandApply = async (
  css: string,
  uno: UnoGenerator,
  warn: (message: string) => void,
): Promise<string> => {
  const cache = new Map<string, string>();
  for (const token of new Set(applyTokens(css))) {
    const parsed = await uno.parseToken(token);
    // Only plain utilities (`.token { ... }`) can be inlined into another rule.
    const plain = parsed?.filter(
      (u) => !u[3] && u[1] && u[1].replace(/\\/g, "") === `.${token}`,
    );
    if (!plain || plain.length === 0) {
      warn(`@apply: cannot resolve utility "${token}"; ignored.`);
      continue;
    }
    cache.set(
      token,
      plain.map((u) => u[2].trim().replace(/;+$/, "")).join(";"),
    );
  }
  return css.replace(APPLY, (_, list: string, end: string) => {
    const body = list
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => cache.get(token))
      .filter(Boolean)
      .join(";");
    return body ? `${body}${end === ";" ? ";" : ""}` : "";
  });
};

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

const needsTailwindCss = (css: string) => /@theme\b|@apply\b/.test(css);

/**
 * Generate the CSS for `html`: UnoCSS / Tailwind utilities for every class (and `tw`) token,
 * plus Tailwind v4 `@theme` variables (`:root`) and `@apply` expansion for `<style>` blocks of
 * `html` and for `options.css`.
 *
 * `tw="..."` attributes are not rewritten here: pass the HTML through {@link convertTw} (or use
 * {@link tailwind}) so the elements actually carry the classes.
 */
export const createCSS = async (
  html: string,
  options: TailwindOptions = {},
): Promise<string> => {
  const warn = options.warn ?? warnDefault;
  const userBlocks: string[] = [];
  for (const m of html.matchAll(STYLE_BLOCK)) {
    if (needsTailwindCss(m[1])) userBlocks.push(m[1]);
  }
  if (options.css) userBlocks.push(options.css);

  // Theme tokens feed UnoCSS' theme (colors) so utilities such as `bg-brand` resolve.
  const themed = userBlocks.map((css) => extractTheme(css));
  const variables = Object.assign({}, ...themed.map((t) => t.variables));
  const uno = await createGenerator({
    presets: [presetUno()],
    theme: { colors: themeColors(variables) },
  });

  const extraTokens = userBlocks.flatMap(applyTokens).join(" ");
  const utilities = (await uno.generate(`${html}\n${extraTokens}`)).css;

  const converted: string[] = [];
  for (const t of themed) {
    converted.push(await expandApply(t.css, uno, warn));
  }
  return [utilities, ...converted.filter((css) => css.trim())].join("\n");
};

/**
 * One call for Tailwind v4 style markup: `tw="..."` becomes `class`, and the returned `css` holds the
 * utilities, `@theme` variables and `@apply` expansion. Feed both to `render()`.
 *
 * @example
 * const { html, css } = await tailwind('<div tw="flex gap-2 bg-brand">…</div>', {
 *   css: "@theme { --color-brand: #f00 }",
 * });
 * await render({ value: html, css, width: 600, format: "png" });
 */
export const tailwind = async (
  html: string,
  options: TailwindOptions = {},
): Promise<{ html: string; css: string }> => {
  const converted = convertTw(html);
  return { html: converted, css: await createCSS(converted, options) };
};
