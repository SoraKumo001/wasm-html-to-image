import type { HtmlToImageModule } from "./loader.js";
import { buildFullSatoruOptions } from "./encode-args.js";
import { isImageInput } from "./input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  type DiagnosticMessage,
  type FontDiagnostic,
  type RenderDiagnostics,
  type RenderLimits,
  type ResolveResourceHook,
  type ResourceDiagnostic,
} from "./diagnostics.js";
import {
  createOrchestration,
  resolveHtmlSource,
  runImageInput,
  tryRunHtmlInstance,
  tryRunLegacyFallback,
} from "./core-orchestrate.js";

// Backward compatibility: `isImageInput` now lives in `./input.js` but
// stays importable from here (and therefore from the package root).
export { isImageInput };

// Playground parity: diagnostics surface lives in `./diagnostics.js` but
// stays importable from here (and therefore from `./workers`).
export { DIAGNOSTIC_CODES, LogLevel };
export type {
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./diagnostics.js";

// Backward compatibility: binding-name type now lives in
// `./core-orchestrate.js` but stays importable from here.
export type { WasmBindingName } from "./core-orchestrate.js";

/**
 * Final output formats. Single-WASM internal routing:
 * - HTML input: resources are resolved on the instance first
 *   (`satoru_collect_resources` -> fetch -> `satoru_add_resource`), then
 *   `satoru_render` direct (svg/pdf) or `satoru_render` PNG intermediate ->
 *   `converter_encode`. The unified `html_to_image` binding is only a legacy
 *   fallback for builds without instance render bindings.
 * - Image input: render stage skipped, straight to `converter_*`
 *   (`converter_load_image` -> optional crop/resize -> `converter_encode`,
 *   or `converter_encode_svg` / `converter_encode_pdf`).
 */
export type OutputFormat =
  | "svg"
  | "png"
  | "pdf"
  | "jpeg"
  | "webp"
  | "apng"
  | "gif"
  | "tiff"
  | "avif"
  | "jxl"
  | "raw"
  | "thumbhash"
  | "none";

/** Result of rendering an HTML document or converting an image. */
export interface RenderResult<T = Uint8Array | string> {
  /** Output binary or text (string for svg, Uint8Array for all others). */
  data: T;
  /** Result image width in pixels. */
  width: number;
  /** Result image height in pixels. */
  height: number;
  /** Output format. */
  format: OutputFormat;
  /** Original input image width (image inputs only). */
  originalWidth?: number;
  /** Original input image height (image inputs only). */
  originalHeight?: number;
  /** Original input image format (image inputs only). */
  originalFormat?: string;
  /** Whether the original input image is animated (image inputs only). */
  originalAnimation?: boolean;
  /** Whether the output is animated. */
  animation?: boolean;
}

/**
 * Render input (self-defined; no `satoru-render` dependency).
 * `value` accepts HTML (`string` / `string[]`), a `data:image/` URL string,
 * or raw image bytes (`Uint8Array` / `ArrayBuffer`).
 * Extra keys are passed through to the WASM binding options object.
 */
export interface RenderOptions {
  value?: string | string[] | Uint8Array | ArrayBuffer;
  url?: string;
  baseUrl?: string;
  width: number;
  height?: number;
  format?: OutputFormat;
}

/**
 * Unified options for HTML and image inputs.
 *
 * - HTML input: `width`/`height` are the layout viewport; `crop`/`fit`
 *   are forwarded to the satoru render options.
 * - Image input: render stage is skipped; `width`/`height`/`crop`/`fit`
 *   are applied as output resize on the encode stage.
 */
export interface HtmlToImageOptions extends RenderOptions {
  /** Encode quality 0-100 (encode stage only, default 85; ignored for svg/pdf). */
  quality?: number;
  /** Encode speed 0-10 for AVIF, JXL and animated (lossy) WebP (encode stage only; default 8 for AVIF, 6 otherwise). Animated WebP uses libwebp method `8 - speed`: the default 6 is method 2, 5 is method 3 (Skia's, smaller by ~4%), 9 is method 0 (fastest, ~30% larger). */
  speed?: number;
  /**
   * Animation handling.
   * - `true`: keep animation frames where supported (image input / encode stage).
   * - `{ duration, fps, loop }` (HTML input only): sample the document's
   *   `@keyframes` animation into frames. `duration` is one loop length in ms
   *   (clamped to 5000), `fps` defaults to 15 (frame count capped at ~75).
   *   The CSS `animation-duration` (including the `animation` shorthand)
   *   is the length of one iteration; `animation-delay` /
   *   `animation-iteration-count` define the sampled timeline, capped by
   *   `duration`; `fps` is the upper frame rate. `loop` is how many times the
   *   animated WebP / APNG / GIF repeats: `0` (the default) means infinite, `1` means play
   *   once. `opacity`, `transform` (`translate` / `rotate` / `scale` only) and
   *   `color` / `background-color` keyframes are animated; their values may
   *   use `var()` (resolved against the element's custom properties).
   *   `animation-timing-function` (per keyframe or element-level:
   *   `linear` / `ease*` / `cubic-bezier()` / `steps()` / `step-*`),
   *   `animation-direction` and `animation-fill-mode` are honoured.
   *   Several animations on one element (`animation-name: a, b`) are out of
   *   scope.
   */
  animation?: boolean | { duration: number; fps?: number; loop?: number };
  /** Crop rectangle (encode stage for image input, render options for HTML). */
  crop?: { x: number; y: number; width: number; height: number };
  /** Resize strategy (encode stage for image input, render options for HTML). */
  fit?: "contain" | "cover" | "fill";
  /**
   * Generic family -> font URL map (upstream `DEFAULT_FONT_MAP` strategy).
   * Applied via `satoru_set_font_map` before resource discovery, so
   * `@font-face`-less text (sans-serif/serif/...) resolves through Google
   * Fonts instead of rendering blank. Defaults to `DEFAULT_FONT_MAP`.
   */
  fontMap?: Record<string, string>;
  /** User-Agent for resource fetches (default: Chrome, for woff2 CSS). */
  userAgent?: string;
  /**
   * User-supplied fallback font(s), applied to the instance before resource
   * discovery (upstream `fallbackFonts` idiom). Entries may be raw bytes
   * (`Uint8Array` / `ArrayBuffer`), a `data:` URL, or a fetchable URL
   * (http(s) or baseUrl-relative file on Node).
   */
  fallbackFonts?: (Uint8Array | ArrayBuffer | string)[];
  /**
   * Log severity gate for `onLog` (satoru `LogLevel` parity; default
   * `None` silences all JS-side log calls). Also forwarded to the WASM
   * `satoru_set_log_level` binding when set.
   */
  logLevel?: LogLevel;
  /** JS-side log hook, called at stage boundaries, warnings, and errors. */
  onLog?: (level: LogLevel, message: string) => void;
  /** Collect a full `RenderDiagnostics` report (delivered to `onDiagnostics`). */
  diagnostics?: boolean;
  /** Receives the diagnostics report when `diagnostics` is enabled. */
  onDiagnostics?: (report: RenderDiagnostics) => void;
  /**
   * Override hook for resource resolution, applied to every fetch path
   * (discovery fetches, fallback-font URLs, HTML `url` fetch). Return
   * bytes to inject, or `null` to skip the resource.
   */
  resolveResource?: ResolveResourceHook;
  /** Media type for CSS `@media` queries (default `"screen"`). */
  mediaType?: "screen" | "print";
  /** Render SVG text as paths (default `true`, satoru parity). */
  textToPaths?: boolean;
  /** Extra CSS pre-scanned on the instance before discovery. */
  css?: string;
  /** Named fonts pre-loaded on the instance before discovery. */
  fonts?: { name: string; data: Uint8Array }[];
  /** Safety/performance limits, enforced in JS around resource resolution. */
  limits?: RenderLimits;
  /**
   * Pixel density of raster output from HTML input (default `1`). The page is laid out at
   * `width` CSS px and drawn `scale` times larger, so `scale: 3.125` turns an 800px layout
   * into a 2500px bitmap (300 dpi for an 8.33in page) with text and shapes re-rasterized
   * sharply. `width` / `height` / `crop` stay in CSS px; the result's `width` / `height` are
   * the bitmap size. Range 0-16; ignored for `svg` / `pdf` and for image input.
   */
  scale?: number;
  /**
   * Resolution written to the `tiff` file, in pixels per inch (default `96 * scale`, rounded:
   * one CSS px is 1/96 in). A print shop reads the physical size from it.
   */
  dpi?: number;
  /**
   * Output color space of `tiff` and `pdf` (default `"srgb"`).
   *
   * - `"srgb"`: RGB (TIFF keeps the alpha channel).
   * - `"cmyk"`: CMYK for print. TIFF is written as a separated image with transparency
   *   flattened onto white; PDF has every fill / stroke color and image rewritten to
   *   DeviceCMYK. The conversion is the plain device formula (K = 1 - max(R, G, B), pure
   *   black stays K only); it applies no ICC profile, so saturated screen colors are not
   *   gamut-mapped. Other formats ignore it.
   */
  colorSpace?: "srgb" | "cmyk";
  /** PDF Title metadata. */
  pdfTitle?: string;
  /** PDF Author metadata. */
  pdfAuthor?: string;
  /** PDF Subject metadata. */
  pdfSubject?: string;
  /** PDF Keywords metadata. */
  pdfKeywords?: string;
  /** PDF Creator metadata. */
  pdfCreator?: string;
  /** PDF Producer metadata. */
  pdfProducer?: string;
  /** PDF page margins in pixels. */
  pdfMargin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** PDF header HTML template. */
  pdfHeader?: string;
  /** PDF footer HTML template. */
  pdfFooter?: string;
  /** Extra keys are forwarded to the WASM render options object. */
  [key: string]: unknown;
}

const EMOJI_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2";

/**
 * Upstream default font strategy (verbatim from satoru `DEFAULT_FONT_MAP`):
 * generic families resolve to Google Fonts css2 URLs (fetched with a browser
 * UA so woff2 is served); fetched at render time, nothing bundled.
 */
export const DEFAULT_FONT_MAP: Record<string, string> = {
  "sans-serif": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900",
  serif: "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@200..900",
  monospace: "https://fonts.googleapis.com/css2?family=M+PLUS+1+Code",
  cursive: "https://fonts.googleapis.com/css2?family=Yuji+Syuku",
  fantasy: "https://fonts.googleapis.com/css2?family=Reggae+One",
  "Noto Color Emoji": EMOJI_URL,
  emoji: EMOJI_URL,
  "Noto Emoji": EMOJI_URL,
  notocoloremoji: EMOJI_URL,
  notoemoji: EMOJI_URL,
};

/**
 * Render HTML — or convert an image — through the single unified WASM
 * module. Image input skips the render stage and goes straight to
 * `converter_encode`. Returns bytes (`Uint8Array`); only `svg` resolves
 * to `string`.
 *
 * Thin orchestration: context comes from `./core-orchestrate.ts`, resource
 * discovery from `./core-resources.ts`, satoru options from
 * `./encode-args.ts` (canonical builder). Branch selection uses
 * `isImageInput` (`./input.ts`).
 */
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>> {
  const orch = createOrchestration(module, options);
  const { format, width, emitLog, logged, loggedBinding } = orch;
  emitLog(LogLevel.Info, `render start: format=${format} width=${width}`);

  // ---- Image input: skip rendering, straight to converter_* ----
  if (isImageInput(options.value)) {
    return runImageInput(module, options.value, orch);
  }

  // ---- HTML input: resolve resources on the instance, then render ----
  // (unified `html_to_image` builds its own instance internally and cannot
  // see pre-resolved fonts/images, so it is only a legacy fallback here).
  if (format === "none") {
    throw logged(
      "wasm-html-to-image: 'none' format is only supported for image inputs",
    );
  }
  const htmls = await resolveHtmlSource(orch);
  const satoruOpts = buildFullSatoruOptions({
    crop: orch.crop,
    fit: orch.fit,
    textToPaths: orch.textToPaths,
    mediaTypeInt: orch.mediaTypeInt,
    colorSpace: orch.colorSpace,
    scale: orch.scale,
    pdfTitle: orch.pdfTitle,
    pdfAuthor: orch.pdfAuthor,
    pdfSubject: orch.pdfSubject,
    pdfKeywords: orch.pdfKeywords,
    pdfCreator: orch.pdfCreator,
    pdfProducer: orch.pdfProducer,
    pdfMargin: orch.pdfMargin,
    pdfHeader: orch.pdfHeader,
    pdfFooter: orch.pdfFooter,
  });

  const inst = await tryRunHtmlInstance(
    module,
    htmls,
    satoruOpts,
    DEFAULT_FONT_MAP,
    orch,
  );
  if (inst) return inst;

  // Legacy fallback for builds without instance render bindings.
  const legacy = await tryRunLegacyFallback(module, htmls, satoruOpts, orch);
  if (legacy) return legacy;
  throw loggedBinding("satoru_render");
}
