import { marked, Marked } from "marked";
import { mathExtension, type MathRenderer } from "./markdown-math-syntax.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdownLang from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// A private instance: registering languages must not leak into an app's own highlight.js.
const highlighter = hljs.newInstance();
for (const [name, def] of Object.entries({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown: markdownLang, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})) {
  highlighter.registerLanguage(name, def);
}
highlighter.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
highlighter.registerAliases(["ts", "tsx"], { languageName: "typescript" });
highlighter.registerAliases(["sh", "zsh"], { languageName: "bash" });
highlighter.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
highlighter.registerAliases(["yml"], { languageName: "yaml" });
highlighter.registerAliases(["py"], { languageName: "python" });
highlighter.registerAliases(["rs"], { languageName: "rust" });
highlighter.registerAliases(["rb"], { languageName: "ruby" });
highlighter.registerAliases(["md"], { languageName: "markdown" });
highlighter.registerAliases(["c++", "h", "hpp"], { languageName: "cpp" });
highlighter.registerAliases(["cs"], { languageName: "csharp" });
highlighter.registerAliases(["kt"], { languageName: "kotlin" });
highlighter.registerAliases(["toml"], { languageName: "ini" });

/** Options for {@link markdownToHtml}. */
export interface MarkdownOptions {
  /** Colour scheme of the built-in stylesheet. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Extra CSS appended after the built-in stylesheet (it wins on equal specificity). */
  css?: string;
  /** Page padding around the article in px. Defaults to 32. */
  padding?: number;
  /**
   * Paginated output (`format: "pdf"`): `padding` becomes the `@page` margin on every page instead
   * of padding around the article, so pages after the first keep their top and bottom margins.
   */
  paged?: boolean;
  /** Maximum width of the article in px; omit for the full viewport width. */
  maxWidth?: number;
  /** `<title>` of the generated document. Defaults to the `title` of the front matter, if any. */
  title?: string;
  /** Highlight fenced code blocks that name a known language. Defaults to true. */
  highlight?: boolean;
  /** Strip a leading `---` YAML front matter block (and read its `title`). Defaults to true. */
  frontMatter?: boolean;
  /**
   * Typeset `$...$` and `$$...$$` with this renderer (`katexMath()` from `wasm-html-to-image/markdown-math`).
   * Without it a dollar sign is just text.
   */
  math?: MathRenderer;
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
    keyword: "#cf222e",
    string: "#0a3069",
    comment: "#6e7781",
    number: "#0550ae",
    title: "#8250df",
    tag: "#116329",
    add: "#dafbe1",
    del: "#ffebe9",
  },
  dark: {
    fg: "#e6edf3",
    muted: "#9198a1",
    bg: "#0d1117",
    border: "#3d444d",
    codeBg: "#151b23",
    link: "#4493f8",
    quote: "#9198a1",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    comment: "#8b949e",
    number: "#79c0ff",
    title: "#d2a8ff",
    tag: "#7ee787",
    add: "#12261e",
    del: "#3c1618",
  },
} as const;

/** The built-in GitHub-like stylesheet. Plain selectors only: it has to render in the engine as well. */
export function markdownStylesheet(
  theme: "light" | "dark" = "light",
  padding = 32,
  maxWidth?: number,
  paged = false,
): string {
  const c = PALETTES[theme];
  return `${paged ? `@page { margin: ${padding}px; }\n` : ""}html, body { margin: 0; padding: 0; background: ${c.bg}; }
body { color: ${c.fg}; font-family: sans-serif; font-size: 16px; line-height: 1.5; }
.markdown-body { padding: ${paged ? 0 : padding}px;${maxWidth ? ` max-width: ${maxWidth}px; margin: 0 auto;` : ""} }
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
.hljs-keyword, .hljs-doctag, .hljs-template-tag, .hljs-type, .hljs-meta { color: ${c.keyword}; }
.hljs-string, .hljs-regexp, .hljs-symbol { color: ${c.string}; }
.hljs-comment, .hljs-quote { color: ${c.comment}; }
.hljs-number, .hljs-literal, .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-built_in, .hljs-selector-id, .hljs-selector-class, .hljs-params { color: ${c.number}; }
.hljs-title { color: ${c.title}; }
.hljs-name, .hljs-tag, .hljs-selector-tag, .hljs-bullet { color: ${c.tag}; }
.hljs-section { color: ${c.number}; font-weight: 600; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
.hljs-addition { color: ${c.tag}; background: ${c.add}; }
.hljs-deletion { color: ${c.keyword}; background: ${c.del}; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { break-after: avoid; }
.markdown-body pre, .markdown-body table, .markdown-body blockquote, .markdown-body img, .markdown-body tr { break-inside: avoid; }
`;
}

/**
 * Convert Markdown (GitHub flavoured, via `marked`) to a complete HTML document with a built-in
 * GitHub-like stylesheet, ready to pass to `render({ value })`.
 */
export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): string {
  let source = markdown;
  let frontTitle: string | undefined;
  if (options.frontMatter !== false) {
    const front = /^\uFEFF?---[ \t]*\r?\n([^]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    if (front) {
      source = source.slice(front[0].length);
      const t = /^title:[ \t]*(.+?)[ \t]*$/m.exec(front[1]);
      if (t) frontTitle = t[1].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const renderer = new marked.Renderer();
  if (options.highlight !== false) {
    renderer.code = ({ text, lang }) => {
      const name = (lang ?? "").trim().split(/\s+/)[0];
      const body = name && highlighter.getLanguage(name)
        ? highlighter.highlight(text, { language: name, ignoreIllegals: true }).value
        : escapeHtml(text);
      return `<pre><code${name ? ` class="language-${escapeHtml(name)}"` : ""}>${body}\n</code></pre>\n`;
    };
  }
  const parser = options.math ? new Marked(mathExtension(options.math)) : marked;
  const body = parser.parse(source, { async: false, gfm: true, renderer }) as string;
  const sheet =
    options.stylesheet ??
    markdownStylesheet(options.theme, options.padding, options.maxWidth, options.paged);
  const titleText = options.title ?? frontTitle;
  const title = titleText ? `<title>${escapeHtml(titleText)}</title>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${title}<style>${sheet}${options.math?.css ?? ""}${options.css ?? ""}</style></head><body><article class="markdown-body">${body}</article></body></html>`;
}
