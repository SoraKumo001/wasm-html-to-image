/**
 * Mermaid diagrams as images or SVG. The engine draws `<div class="mermaid">` itself (flowchart, sequence,
 * state, class, ER, pie and xy charts); this module wraps a diagram source in a small page and renders it,
 * sized to the diagram.
 *
 * ```ts
 * import { renderMermaid } from "wasm-html-to-image";
 *
 * const { data: svg } = await renderMermaid("graph LR\n  A --> B"); // an SVG string
 * const { data: png } = await renderMermaid("graph LR\n  A --> B", { format: "png", theme: "dark" });
 * ```
 */

import type { HtmlToImageOptions, OutputFormat, RenderResult } from "./core.js";

export interface MermaidOptions {
  /** Colour scheme. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Output format. Defaults to `"svg"` (a string); `"png"`, `"webp"`, `"pdf"`, ... give bytes. */
  format?: OutputFormat;
  /** Space around the diagram in px. Defaults to 16. */
  padding?: number;
  /** Image width in px. Defaults to the diagram's width plus the padding. */
  width?: number;
  /** Page background: a CSS colour, or `"transparent"`. Defaults to the theme's background for raster output, transparent for SVG. */
  background?: string;
  /** The accent colour of the diagram (arrows, bars); the theme's derived colour when omitted. */
  accent?: string;
  /**
   * How much a broken source is forgiven. `"strict"` (default) reports every mistake; `"compat"` also accepts a
   * keyword in the wrong case and unfinished `end` / `}` blocks; `"recover"` also fixes a misspelt keyword and skips
   * lines the diagram cannot read. What was repaired is left in the SVG as a leading `<!-- recovered: ... -->` comment.
   */
  mode?: "strict" | "compat" | "recover";
}

/** What a render function takes: `render` of `wasm-html-to-image`, or `htmlToImage` with its module applied. */
export type RenderFn = (options: HtmlToImageOptions) => Promise<RenderResult<Uint8Array | string>>;

/** The colours the engine reads from `--mermaid-*`; the same values as the Markdown stylesheet. */
export const MERMAID_THEMES = {
  light: { fg: "#1f2328", bg: "#ffffff", border: "#d1d9e0", surface: "#f6f8fa" },
  dark: { fg: "#e6edf3", bg: "#0d1117", border: "#3d444d", surface: "#151b23" },
} as const;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page that holds one diagram, for `render({ value, ... })`. */
export function mermaidToHtml(source: string, options: Pick<MermaidOptions, "theme" | "padding" | "background" | "accent" | "mode"> & { raster?: boolean } = {}): string {
  const c = MERMAID_THEMES[options.theme ?? "light"];
  const padding = options.padding ?? 16;
  const background = options.background ?? (options.raster ? c.bg : "transparent");
  const accent = (options.accent ? ` --mermaid-accent: ${options.accent};` : "") + (options.mode && options.mode !== "strict" ? ` --mermaid-mode: ${options.mode};` : "");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html, body { margin: 0; padding: 0; background: ${background}; }` +
    `body { padding: ${padding}px; }` +
    `.mermaid { display: inline-block; color: ${c.fg}; --mermaid-fg: ${c.fg}; --mermaid-bg: ${c.bg}; --mermaid-border: ${c.border}; --mermaid-surface: ${c.surface};${accent} }` +
    `</style></head><body><div class="mermaid">${escapeHtml(source)}</div></body></html>`
  );
}

/** The width and height of the diagram in an SVG that was rendered from {@link mermaidToHtml}. */
function diagramSize(svg: string): { width: number; height: number } | undefined {
  const m = /<svg\b[^>]*?\bwidth="([\d.]+)"[^>]*?\bheight="([\d.]+)"/.exec(svg.slice(svg.indexOf("</defs>")));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/**
 * Render a Mermaid diagram with the given render function. The page is first laid out wide to learn the
 * diagram's size, then rendered at exactly that width (unless `width` is given), so the result has no
 * stray margin.
 */
export async function renderMermaidWith(
  render: RenderFn,
  source: string,
  options: MermaidOptions = {},
): Promise<RenderResult<Uint8Array | string>> {
  const format = options.format ?? "svg";
  const padding = options.padding ?? 16;
  const raster = format !== "svg";
  const value = mermaidToHtml(source, { ...options, raster });
  let width = options.width;
  if (width === undefined) {
    const probe = await render({ value, width: 4096, format: "svg" });
    const size = typeof probe.data === "string" ? diagramSize(probe.data) : undefined;
    width = size ? Math.ceil(size.width + 2 * padding) : 800;
  }
  return render({ value, width, format });
}

/** The shape of `renderMermaid` in each entry point: SVG text by default, bytes for the other formats. */
export interface RenderMermaid {
  (source: string, options?: MermaidOptions & { format?: "svg" }): Promise<RenderResult<string>>;
  (source: string, options: MermaidOptions): Promise<RenderResult<Uint8Array | string>>;
}

/** Bind {@link renderMermaidWith} to an entry point's `render`. */
export function bindRenderMermaid(render: RenderFn): RenderMermaid {
  return ((source: string, options?: MermaidOptions) => renderMermaidWith(render, source, options)) as RenderMermaid;
}
