import { marked } from "marked";

/** Options for {@link markdownToHtml}. */
export interface MarkdownOptions {
  /** Colour scheme of the built-in stylesheet. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Extra CSS appended after the built-in stylesheet (it wins on equal specificity). */
  css?: string;
  /** Page padding around the article in px. Defaults to 32. */
  padding?: number;
  /** Maximum width of the article in px; omit for the full viewport width. */
  maxWidth?: number;
  /** `<title>` of the generated document. */
  title?: string;
  /** Replace the built-in stylesheet entirely (`theme` is then ignored). */
  stylesheet?: string;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PALETTES = {
  light: {
    fg: "#1f2328",
    muted: "#59636e",
    bg: "#ffffff",
    border: "#d1d9e0",
    codeBg: "#f6f8fa",
    link: "#0969da",
    quote: "#59636e",
  },
  dark: {
    fg: "#e6edf3",
    muted: "#9198a1",
    bg: "#0d1117",
    border: "#3d444d",
    codeBg: "#151b23",
    link: "#4493f8",
    quote: "#9198a1",
  },
} as const;

/** The built-in GitHub-like stylesheet. Plain selectors only: it has to render in the engine as well. */
export function markdownStylesheet(
  theme: "light" | "dark" = "light",
  padding = 32,
  maxWidth?: number,
): string {
  const c = PALETTES[theme];
  return `html, body { margin: 0; padding: 0; background: ${c.bg}; }
body { color: ${c.fg}; font-family: sans-serif; font-size: 16px; line-height: 1.5; }
.markdown-body { padding: ${padding}px;${maxWidth ? ` max-width: ${maxWidth}px; margin: 0 auto;` : ""} }
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child { margin-bottom: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
.markdown-body h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid ${c.border}; }
.markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid ${c.border}; }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: 0.875em; }
.markdown-body h6 { font-size: 0.85em; color: ${c.muted}; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table { margin-top: 0; margin-bottom: 16px; }
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }
.markdown-body li > ul, .markdown-body li > ol { margin-top: 0.25em; margin-bottom: 0; }
.markdown-body a { color: ${c.link}; text-decoration: none; }
.markdown-body strong { font-weight: 600; }
.markdown-body blockquote { padding: 0 1em; color: ${c.quote}; border-left: 4px solid ${c.border}; }
.markdown-body blockquote > *:last-child { margin-bottom: 0; }
.markdown-body code { padding: 0.2em 0.4em; font-family: monospace; font-size: 85%; background: ${c.codeBg}; border-radius: 6px; }
.markdown-body pre { padding: 16px; overflow: hidden; font-size: 85%; line-height: 1.45; background: ${c.codeBg}; border-radius: 6px; }
.markdown-body pre code { padding: 0; font-size: 100%; background: transparent; white-space: pre; }
.markdown-body hr { height: 0; margin: 24px 0; border: 0; border-top: 4px solid ${c.border}; }
.markdown-body img { max-width: 100%; }
.markdown-body table { border-collapse: collapse; }
.markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid ${c.border}; }
.markdown-body th { font-weight: 600; }
.markdown-body tr:nth-child(2n) { background: ${c.codeBg}; }
.markdown-body input[type="checkbox"] { margin: 0 0.4em 0 -1.4em; }
`;
}

/**
 * Convert Markdown (GitHub flavoured, via `marked`) to a complete HTML document with a built-in
 * GitHub-like stylesheet, ready to pass to `render({ value })`.
 */
export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): string {
  const body = marked.parse(markdown, { async: false, gfm: true }) as string;
  const sheet =
    options.stylesheet ??
    markdownStylesheet(options.theme, options.padding, options.maxWidth);
  const title = options.title ? `<title>${escapeHtml(options.title)}</title>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${title}<style>${sheet}${options.css ?? ""}</style></head><body><article class="markdown-body">${body}</article></body></html>`;
}
