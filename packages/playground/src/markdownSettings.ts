import type { MarkdownOptions } from "wasm-html-to-image/markdown";

/** A choice the panel may leave to the document (its front matter / the template): "auto". */
export type Tri = "auto" | "on" | "off";

/**
 * The Markdown playground's panel. Every field is an override: "auto" / "" leave the decision to the
 * document's front matter and the template, so what the panel shows is what it changes, nothing more.
 */
export interface MarkdownPanel {
  /** A bundled template name, or "" for whatever the document's front matter says (else the default). */
  template: string;
  theme: "light" | "dark";
  /** `A4`, `A5`, ... or "" for the template's own size. */
  pageSize: string;
  accent: string;
  /** Body font family, e.g. `serif`; "" keeps the template's. */
  font: string;
  stamp: string;
  cover: Tri;
  toc: Tri;
  /** Deepest heading level in the contents (1-6). */
  tocDepth: number;
  /** Bookmarks (the PDF outline). */
  outline: boolean;
  math: boolean;
  highlight: boolean;
  /** Render width in px: the PDF page takes its size from the template, this is the layout width without one. */
  width: number;
}

export const DEFAULT_PANEL: MarkdownPanel = {
  template: "",
  theme: "light",
  pageSize: "",
  accent: "",
  font: "",
  stamp: "",
  cover: "auto",
  toc: "auto",
  tocDepth: 3,
  outline: true,
  math: true,
  highlight: true,
  width: 794,
};

export const PAGE_SIZES = ["A3", "A4", "A5", "B4", "B5", "Letter", "Legal"];

const triToBool = (t: Tri): boolean | undefined => (t === "auto" ? undefined : t === "on");

/**
 * The options for `markdownToDocument`. `math` is the renderer (`katexMath()`), passed in so this
 * module stays free of the KaTeX bundle: the page loads it only when maths is switched on.
 */
export function toMarkdownOptions(panel: MarkdownPanel, math?: MarkdownOptions["math"]): MarkdownOptions {
  const settings: NonNullable<MarkdownOptions["settings"]> = {
    ...(panel.pageSize ? { page_size: panel.pageSize } : {}),
    ...(panel.accent ? { accent: panel.accent } : {}),
    ...(panel.font ? { font: panel.font } : {}),
    ...(panel.stamp ? { stamp: panel.stamp } : {}),
    ...(triToBool(panel.cover) !== undefined ? { cover: triToBool(panel.cover) } : {}),
  };
  const toc = triToBool(panel.toc);
  return {
    paged: true,
    theme: panel.theme,
    ...(panel.template ? { template: panel.template } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    // "auto" keeps the template's / document's choice; an explicit on carries the depth
    ...(toc === false ? { toc: false } : toc === true ? { toc: { depth: panel.tocDepth } } : {}),
    highlight: panel.highlight,
    ...(panel.math && math ? { math } : {}),
  };
}

const KEYS: (keyof MarkdownPanel)[] = [
  "template",
  "theme",
  "pageSize",
  "accent",
  "font",
  "stamp",
  "cover",
  "toc",
  "tocDepth",
  "outline",
  "math",
  "highlight",
  "width",
];

/** The panel as URL parameters, leaving out what equals the default (a short, shareable link). */
export function panelToParams(panel: MarkdownPanel): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    if (panel[key] !== DEFAULT_PANEL[key]) params.set(key, String(panel[key]));
  }
  return params;
}

/** The panel from URL parameters; a missing or invalid value falls back to the default. */
export function panelFromParams(params: URLSearchParams): MarkdownPanel {
  const panel = { ...DEFAULT_PANEL };
  const str = (k: keyof MarkdownPanel) => params.get(k) ?? undefined;
  const tri = (v: string | undefined): Tri | undefined => (v === "auto" || v === "on" || v === "off" ? v : undefined);
  const bool = (v: string | undefined) => (v === "true" ? true : v === "false" ? false : undefined);
  const int = (v: string | undefined, min: number, max: number) => {
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  panel.template = str("template") ?? panel.template;
  const theme = str("theme");
  if (theme === "light" || theme === "dark") panel.theme = theme;
  panel.pageSize = str("pageSize") ?? panel.pageSize;
  panel.accent = str("accent") ?? panel.accent;
  panel.font = str("font") ?? panel.font;
  panel.stamp = str("stamp") ?? panel.stamp;
  panel.cover = tri(str("cover")) ?? panel.cover;
  panel.toc = tri(str("toc")) ?? panel.toc;
  panel.tocDepth = int(str("tocDepth"), 1, 6) ?? panel.tocDepth;
  panel.outline = bool(str("outline")) ?? panel.outline;
  panel.math = bool(str("math")) ?? panel.math;
  panel.highlight = bool(str("highlight")) ?? panel.highlight;
  panel.width = int(str("width"), 200, 4000) ?? panel.width;
  return panel;
}
