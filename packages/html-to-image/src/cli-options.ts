/**
 * CLI flag plumbing split from `./cli.ts` (behavior unchanged): input-type
 * detection, local file reading, and the flag -> `render()` option mapping.
 * Kept separate from the executable entry point so the mapping is
 * unit-testable without running the CLI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isImageInput } from "./input.js";
import type { HtmlToImageOptions, OutputFormat } from "./core.js";

/** Flags as parsed by commander (see `./cli.ts`). */
export interface CliFlags {
  output?: string;
  width: number;
  height?: number;
  format: OutputFormat;
  quality: number;
  /** Explicit `--base-url`; absent means "let the source decide". */
  baseUrl?: string;
  /** `--color-space <srgb|cmyk>`; absent means the default (srgb). */
  colorSpace?: "srgb" | "cmyk";
  /** `--scale <n>`; absent means 1. */
  scale?: number;
  /** `--dpi <n>`; absent means 96 x scale. */
  dpi?: number;
  /** `--animation <duration-ms>`; absent means "no keyframe animation". */
  animation?: number;
  /** `--animation-fps <n>`; defaults to 15 when `--animation` is set. */
  animationFps?: number;
  /**
   * `--animation-loop <n>`; how many times the animated WebP repeats.
   * Absent means infinite (libwebp loop_count 0 = the historical default).
   */
  animationLoop?: number;
  /** `--font <path-or-glob>` (repeatable); local font files to register. */
  font?: string[];
  /** `--js`: run the page's scripts (jsdom) before rendering. */
  js?: boolean;
  /** `--markdown`: treat the input as Markdown (implied by a `.md` / `.markdown` file). */
  markdown?: boolean;
  /** `--markdown-theme <light|dark>`; absent means light. */
  markdownTheme?: string;
  /** `--markdown-css <path>`: extra stylesheet appended after the built-in one. */
  markdownCss?: string;
  /** `--js-wait <ms|selector>`: a number is the settle time after load, anything else a CSS selector to wait for. */
  jsWait?: string;
}

/** `--js-wait`: milliseconds to settle after load, or a CSS selector to wait for. */
export function resolveJavaScript(wait: string | undefined): true | { settleMs?: number; waitFor?: string } {
  if (wait === undefined || wait === "") return true;
  return /^\d+(\.\d+)?$/.test(wait) ? { settleMs: Number(wait) } : { waitFor: wait };
}

/** Default frame rate for `--animation` when `--animation-fps` is omitted. */
export const DEFAULT_ANIMATION_FPS = 15;

/**
 * Animation flags resolved against the output format.
 *
 * Animated WebP is the only animated output the pipeline supports, so
 * `--animation` is ignored (with a warning) for every other format. The
 * boolean `animation: true` image-input path is intentionally not reachable
 * from the CLI: there the object form requests `@keyframes` sampling, which
 * is what `--animation` means.
 */
export interface AnimationResolution {
  /** Resolved `render()` animation option, or absent when disabled/ignored. */
  animation?: { duration: number; fps: number; loop?: number };
  /** Human-readable reason the flag was dropped; callers warn on stderr. */
  warning?: string;
}

/** Map `--animation` / `--animation-fps` / `--animation-loop` to the `render()` animation option. */
export function resolveAnimation(flags: CliFlags): AnimationResolution {
  if (flags.animation === undefined) {
    if (flags.animationFps !== undefined) {
      return { warning: "--animation-fps requires --animation; ignoring." };
    }
    if (flags.animationLoop !== undefined) {
      return { warning: "--animation-loop requires --animation; ignoring." };
    }
    return {};
  }
  if (flags.format !== "webp" && flags.format !== "apng" && flags.format !== "gif") {
    return {
      warning: `--animation is only supported for webp, apng and gif output; ignoring (format=${flags.format}).`,
    };
  }
  // `loop` stays absent unless requested: the render() default (0) is the
  // historical infinite loop, so the option object keeps its old shape.
  const loop =
    flags.animationLoop === undefined
      ? undefined
      : Math.max(0, Math.trunc(flags.animationLoop));
  return {
    animation: {
      duration: flags.animation,
      fps: flags.animationFps ?? DEFAULT_ANIMATION_FPS,
      ...(loop === undefined ? {} : { loop }),
    },
  };
}

const EXTENSION_FORMATS: Record<string, OutputFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  apng: "apng",
  gif: "gif",
  svg: "svg",
  pdf: "pdf",
  tif: "tiff",
  tiff: "tiff",
  avif: "avif",
  jxl: "jxl",
};

/** Output format implied by the output file's extension, if recognised. */
export function inferFormat(output: string | undefined): OutputFormat | undefined {
  if (!output) return undefined;
  const ext = path.extname(output).slice(1).toLowerCase();
  return EXTENSION_FORMATS[ext];
}

/** Whether `input` names an existing file (a Markdown text or HTML string is not a path). */
export async function isFile(input: string): Promise<boolean> {
  try {
    return (await fs.stat(input)).isFile();
  } catch {
    return false;
  }
}

/** Markdown text passed with `--markdown` instead of a file path. */
export async function isInlineMarkdown(input: string, flags: { markdown?: boolean }): Promise<boolean> {
  return !!flags.markdown && input !== "-" && !isUrlInput(input) && !(await isFile(input));
}

/** A `.md` / `.markdown` file path is Markdown input without `--markdown`. */
export function isMarkdownPath(input: string): boolean {
  return /\.(md|markdown)$/i.test(input) && !isUrlInput(input);
}

/** Convert Markdown text to a styled HTML document (`marked` is an optional dependency). */
export async function markdownToDocument(markdown: string, flags: CliFlags): Promise<string> {
  let mod: typeof import("./markdown.js");
  try {
    mod = await import("./markdown.js");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new Error(
      "Markdown input needs the optional dependency `marked`. Install it with `npm i marked`.",
    );
  }
  const theme = flags.markdownTheme?.toLowerCase();
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    throw new Error(`unsupported markdown theme "${flags.markdownTheme}". Choose from: light, dark`);
  }
  const css = flags.markdownCss ? await fs.readFile(flags.markdownCss, "utf-8") : undefined;
  return mod.markdownToHtml(markdown, { theme, css, paged: flags.format === "pdf" });
}

/** Inline markup passed on the command line (as opposed to a path or URL). */
export function isInlineHtml(input: string): boolean {
  return input.trimStart().startsWith("<");
}

/** Read all of standard input as UTF-8 text. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** Expand `*` / `?` in the last path segment; other patterns are literal paths. */
export async function expandGlob(pattern: string): Promise<string[]> {
  if (!/[*?]/.test(pattern)) return [pattern];
  const dir = path.dirname(pattern);
  const re = new RegExp(
    "^" +
      path
        .basename(pattern)
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  const names = await fs.readdir(dir);
  return names
    .filter((n) => re.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Load `--font` files. Each is named after its file (without extension), or after the family
 * given as `Family Name=path` (use it to stand in for a system font such as `Segoe UI`).
 */
export async function loadFonts(
  patterns: string[],
): Promise<{ name: string; data: Uint8Array }[]> {
  const fonts: { name: string; data: Uint8Array }[] = [];
  for (const spec of patterns) {
    // `Family=path`: a drive letter (`C:\...`) has no `=`, so the first `=` splits family and path.
    const eq = spec.indexOf("=");
    const family = eq > 0 ? spec.slice(0, eq).trim() : undefined;
    const pattern = eq > 0 ? spec.slice(eq + 1) : spec;
    const files = await expandGlob(pattern);
    if (files.length === 0) {
      console.warn(`wasm-html-to-image: no font files match "${pattern}"`);
    }
    for (const file of files) {
      fonts.push({
        name: family ?? path.basename(file, path.extname(file)),
        data: new Uint8Array(await fs.readFile(file)),
      });
    }
  }
  return fonts;
}

/**
 * URL inputs are fetched, not read from disk. `data:` URLs stay values so
 * image inputs keep flowing through the converter pipeline.
 */
export function isUrlInput(input: string): boolean {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(input);
  return (
    !isWindowsPath &&
    /^[a-z][a-z0-9+.-]*:/i.test(input) &&
    !input.startsWith("data:")
  );
}

/**
 * Read a local input file as binary; image files (magic-byte sniffed) are
 * passed through as bytes, everything else as UTF-8 text (HTML).
 */
export async function readInput(
  input: string,
): Promise<{ value: string | Uint8Array; baseUrl: string }> {
  const data = await fs.readFile(input);
  let value: string | Uint8Array = data.toString("utf-8");
  try {
    if (isImageInput(data)) value = data;
  } catch {
    // Unknown binary magic -> treat as text and let rendering decide.
  }
  return { value, baseUrl: path.dirname(path.resolve(input)) };
}

/**
 * Map CLI flags to `render()` options.
 *
 * `--base-url` is the only way to pin the base: without it a URL input leaves
 * `baseUrl` unset so relative resources follow the post-redirect final URL
 * (`resolveHtmlSource`), while a file input falls back to its own directory.
 */
export async function buildRenderOptions(
  input: string,
  flags: CliFlags,
): Promise<HtmlToImageOptions> {
  const markdown = flags.markdown || isMarkdownPath(input);
  // `--markdown` takes a file path, `-` (stdin) or the Markdown text itself.
  const inlineMarkdown = await isInlineMarkdown(input, flags);
  let source = inlineMarkdown || isInlineHtml(input)
    ? { value: input, baseUrl: process.cwd() }
    : input === "-"
      ? { value: await readStdin(), baseUrl: process.cwd() }
      : isUrlInput(input)
        ? { url: input }
        : await readInput(input);
  if (markdown && "value" in source && typeof source.value === "string") {
    source = { ...source, value: await markdownToDocument(source.value, flags) };
  }
  const fonts = flags.font?.length ? await loadFonts(flags.font) : [];
  const { animation, warning } = resolveAnimation(flags);
  if (warning) console.warn(`wasm-html-to-image: ${warning}`);
  return {
    width: flags.width,
    height: flags.height,
    format: flags.format,
    quality: flags.quality,
    ...source,
    ...(flags.baseUrl !== undefined ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.colorSpace !== undefined ? { colorSpace: flags.colorSpace } : {}),
    ...(flags.scale !== undefined ? { scale: flags.scale } : {}),
    ...(flags.dpi !== undefined ? { dpi: flags.dpi } : {}),
    ...(animation ? { animation } : {}),
    ...(fonts.length ? { fonts } : {}),
    ...(flags.js ? { javascript: resolveJavaScript(flags.jsWait) } : {}),
  };
}
