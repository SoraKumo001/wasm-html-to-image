/**
 * Orchestration + pipeline layer split from `./core.ts` (behavior unchanged).
 *
 * Owns: binding-error helper, orchestration context (log gate, timings,
 * diagnostics state), HTML source resolution (`value`/`url`), the image-input
 * pipeline (`converter_*`), the HTML instance pipeline (`satoru_render` +
 * `converter_encode`), and the legacy `html_to_image` fallback.
 *
 * `core.ts` keeps public types and the `htmlToImage` overloads and delegates
 * here. `isImageInput` (`./input.ts`) is the single branch selector;
 * satoru option objects come from `./encode-args.ts` (canonical builder).
 */
import type { HtmlToImageModule } from "./loader.js";
import { FIT_INT, FORMAT_INT } from "./encode-args.js";
import {
  imageBytesFromUnknown,
  toBytes,
} from "./input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  type RenderDiagnostics,
  type RenderLimits,
  type ResolveResourceHook,
} from "./diagnostics.js";
import {
  now,
  resolveHtmlResources,
  type DiagState,
  type ResolveContext,
} from "./core-resources.js";
import type {
  HtmlToImageOptions,
  OutputFormat,
  RenderResult,
} from "./core.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export { DEFAULT_USER_AGENT };

/** Binding names reported by {@link requireBindingError}. */
export type WasmBindingName =
  | "satoru_render"
  | "converter_encode"
  | "converter_encode_svg"
  | "converter_encode_pdf"
  | "converter_load_image"
  | "html_to_image";

export function requireBindingError(name: WasmBindingName): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is required but not exposed by this build ` +
      `(rebuild the unified module; single-WASM only).`,
  );
}

/** Mutable orchestration state for one `htmlToImage` call. */
export interface Orchestration {
  format: OutputFormat;
  quality: number;
  speed: number;
  animation: boolean;
  width: number;
  height: number | undefined;
  crop: HtmlToImageOptions["crop"];
  fit: HtmlToImageOptions["fit"];
  value: unknown;
  url: string | undefined;
  baseUrl: string | undefined;
  fontMap: Record<string, string> | undefined;
  userAgent: string | undefined;
  fallbackFonts: (Uint8Array | ArrayBuffer | string)[] | undefined;
  logLevel: LogLevel;
  onLog: HtmlToImageOptions["onLog"];
  diagnostics: boolean;
  onDiagnostics: HtmlToImageOptions["onDiagnostics"];
  resolveResource: ResolveResourceHook | undefined;
  mediaType: "screen" | "print";
  textToPaths: boolean | undefined;
  css: string | undefined;
  preloadFonts: { name: string; data: Uint8Array }[] | undefined;
  limits: RenderLimits;
  pdfTitle: string | undefined;
  pdfAuthor: string | undefined;
  pdfSubject: string | undefined;
  pdfKeywords: string | undefined;
  pdfCreator: string | undefined;
  pdfProducer: string | undefined;
  pdfMargin: HtmlToImageOptions["pdfMargin"];
  pdfHeader: string | undefined;
  pdfFooter: string | undefined;
  fmtInt: number;
  mediaTypeInt: number;
  t0: number;
  diag: DiagState | null;
  timings: Record<string, number>;
  emitLog: (level: LogLevel, message: string) => void;
  logged: (message: string) => Error;
  loggedBinding: (name: WasmBindingName) => Error;
  addTime: (name: string, ms: number) => void;
  checkTimeout: () => void;
  deliverReport: () => void;
  resolveCtx: ResolveContext;
}

/** Build per-call orchestration state (log gate, timings, diag, resolve ctx). */
export function createOrchestration(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Orchestration {
  const {
    format = "png",
    quality = 85,
    speed = 6,
    animation = false,
    width,
    height,
    crop,
    fit,
    value,
    url,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    logLevel = LogLevel.None,
    onLog,
    diagnostics = false,
    onDiagnostics,
    resolveResource,
    mediaType = "screen",
    textToPaths,
    css,
    fonts: preloadFonts,
    limits = {},
    pdfTitle,
    pdfAuthor,
    pdfSubject,
    pdfKeywords,
    pdfCreator,
    pdfProducer,
    pdfMargin,
    pdfHeader,
    pdfFooter,
  } = options;
  const fmtInt = FORMAT_INT[format];
  const mediaTypeInt = mediaType === "print" ? 1 : 0;

  /** JS-side log hook, gated by `logLevel` (satoru parity). */
  const emitLog = (level: LogLevel, message: string): void => {
    if (onLog && logLevel !== LogLevel.None && level <= logLevel) {
      try {
        onLog(level, message);
      } catch {
        // User hooks must not break rendering.
      }
    }
  };
  /** Build an Error with an Error-level log line (`throw logged(...)`). */
  const logged = (message: string): Error => {
    emitLog(LogLevel.Error, message);
    return new Error(message);
  };
  const loggedBinding = (name: WasmBindingName): Error => {
    const e = requireBindingError(name);
    emitLog(LogLevel.Error, e.message);
    return e;
  };

  const t0 = now();
  const diag: DiagState | null = diagnostics
    ? {
        resources: [],
        fonts: [],
        warnings: [],
        errors: [],
        totalResourceBytes: 0,
        resourceCount: 0,
      }
    : null;
  const timings: Record<string, number> = {};
  const addTime = (name: string, ms: number): void => {
    if (diag) timings[name] = (timings[name] ?? 0) + ms;
  };
  const checkTimeout = (): void => {
    if (limits.timeoutMs !== undefined && now() - t0 >= limits.timeoutMs) {
      const message = `Render timed out after ${limits.timeoutMs}ms`;
      diag?.errors.push({ code: DIAGNOSTIC_CODES.LIMIT_TIMEOUT, message });
      throw logged(message);
    }
  };
  /** Deliver the diagnostics report on success (satoru parity). */
  const deliverReport = (): void => {
    if (!diag || !onDiagnostics) return;
    try {
      onDiagnostics({
        version: 1,
        format: format as RenderDiagnostics["format"],
        width,
        height,
        mediaType,
        timings,
        resources: diag.resources,
        fonts: diag.fonts,
        warnings: diag.warnings,
        errors: diag.errors,
      });
    } catch {
      // User hooks must not break rendering.
    }
  };
  const resolveCtx: ResolveContext = {
    mediaTypeInt,
    css,
    fonts: preloadFonts,
    limits,
    resolveResource,
    diag,
    t0,
    emitLog,
    addTime,
    checkTimeout,
  };

  if (logLevel !== LogLevel.None) {
    try {
      module.satoru_set_log_level(logLevel);
    } catch {
      // Non-fatal; JS-side logging still works.
    }
  }

  return {
    format: format as OutputFormat,
    quality,
    speed,
    animation,
    width,
    height,
    crop,
    fit,
    value,
    url,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    logLevel,
    onLog,
    diagnostics,
    onDiagnostics,
    resolveResource,
    mediaType,
    textToPaths,
    css,
    preloadFonts,
    limits,
    pdfTitle,
    pdfAuthor,
    pdfSubject,
    pdfKeywords,
    pdfCreator,
    pdfProducer,
    pdfMargin,
    pdfHeader,
    pdfFooter,
    fmtInt,
    mediaTypeInt,
    t0,
    diag,
    timings,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    checkTimeout,
    deliverReport,
    resolveCtx,
  };
}

/**
 * Resolve `value`/`url` to HTML source. `isImageInput` callers branch before
 * this; HTML `value` passes through, `url` is fetched (hook-aware).
 */
export async function resolveHtmlSource(
  orch: Orchestration,
): Promise<string | string[]> {
  const { value, url, userAgent, resolveResource, addTime, logged } = orch;
  if (value !== undefined) {
    return value as string | string[];
  }
  if (typeof url === "string") {
    const headers = { "User-Agent": userAgent ?? DEFAULT_USER_AGENT };
    const fetchStart = now();
    let htmls: string;
    if (resolveResource) {
      const fallbackFetch = async (): Promise<Uint8Array | null> => {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        return toBytes(await res.arrayBuffer());
      };
      const raw = await resolveResource(url, fallbackFetch);
      if (!raw) {
        throw logged(
          `wasm-html-to-image: failed to fetch HTML from URL: ${url}`,
        );
      }
      htmls = new TextDecoder().decode(raw);
    } else {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw logged(
          `wasm-html-to-image: failed to fetch HTML from URL: ${url} (${res.status})`,
        );
      }
      htmls = await res.text();
    }
    addTime("fetchHtml", now() - fetchStart);
    return htmls;
  }
  throw logged(
    "wasm-html-to-image: either 'value' or 'url' must be provided.",
  );
}

/**
 * Image-input pipeline: skip rendering, straight to `converter_*`.
 * Call only when `isImageInput(value)` holds; byte normalization uses
 * `imageBytesFromUnknown` (`unknown` in, no `as` casts).
 */
export async function runImageInput(
  module: HtmlToImageModule,
  value: unknown,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string>> {
  const {
    format,
    quality,
    speed,
    animation,
    width,
    height,
    crop,
    fit,
    fmtInt,
    t0,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    deliverReport,
  } = orch;
  // Narrowed here: caller selected this branch via `isImageInput(value)`.
  const loadImage = module.converter_load_image;
  if (typeof loadImage !== "function")
    throw loggedBinding("converter_load_image");
  const bytes = imageBytesFromUnknown(value);
  const inst = module.converter_create_instance();
  try {
    if (!loadImage(inst, bytes)) {
      throw logged(
        "wasm-html-to-image: failed to load image input (unsupported or corrupt)",
      );
    }
    const originalWidth = module.converter_get_original_width?.(inst) ?? 0;
    const originalHeight = module.converter_get_original_height?.(inst) ?? 0;
    const originalFormat = module.converter_get_original_format?.(inst) ?? "";
    const originalAnimation =
      module.converter_is_original_animation?.(inst) ?? false;

    if (format === "none") {
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, none/passthrough)");
      deliverReport();
      return {
        data: bytes,
        width: originalWidth,
        height: originalHeight,
        format: "none",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: originalAnimation,
      };
    }

    if (crop) {
      module.converter_crop(inst, crop.x, crop.y, crop.width, crop.height);
    }
    if (width !== undefined || height !== undefined) {
      module.converter_resize(
        inst,
        width ?? 0,
        height ?? 0,
        FIT_INT[fit ?? "contain"],
      );
    }
    const outWidth =
      module.converter_get_width?.(inst) ?? width ?? originalWidth;
    const outHeight =
      module.converter_get_height?.(inst) ?? height ?? originalHeight;
    const outAnimation = module.converter_is_animation?.(inst) ?? animation;
    const outFormat =
      (module.converter_get_format?.(inst) as OutputFormat) || format;

    if (format === "svg") {
      const svgBinding = module.converter_encode_svg;
      if (typeof svgBinding !== "function")
        throw loggedBinding("converter_encode_svg");
      const encodeStart = now();
      const svg = (await svgBinding(inst)) as string;
      addTime("encode", now() - encodeStart);
      if (!svg) {
        throw logged("wasm-html-to-image: failed to encode image to svg");
      }
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, svg)");
      deliverReport();
      return {
        data: svg,
        width: outWidth,
        height: outHeight,
        format: "svg",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: false,
      };
    }
    if (format === "pdf") {
      const pdfBinding = module.converter_encode_pdf;
      if (typeof pdfBinding !== "function")
        throw loggedBinding("converter_encode_pdf");
      const encodeStart = now();
      const out = (await pdfBinding(inst)) as Uint8Array | null | undefined;
      addTime("encode", now() - encodeStart);
      if (out == null) {
        throw logged("wasm-html-to-image: failed to encode image to pdf");
      }
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, pdf)");
      deliverReport();
      return {
        data: new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        ),
        width: outWidth,
        height: outHeight,
        format: "pdf",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: false,
      };
    }
    const encodeBinding = module.converter_encode;
    if (typeof encodeBinding !== "function")
      throw loggedBinding("converter_encode");
    const encodeStart = now();
    const out = (await encodeBinding(
      inst,
      fmtInt,
      quality,
      speed,
      animation,
    )) as Uint8Array | null | undefined;
    addTime("encode", now() - encodeStart);
    if (out == null) {
      throw logged("wasm-html-to-image: failed to encode image");
    }
    addTime("total", now() - t0);
    emitLog(LogLevel.Info, `render done (image input, ${format})`);
    deliverReport();
    return {
      data: new Uint8Array(
        out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
      ),
      width: outWidth,
      height: outHeight,
      format: outFormat,
      originalWidth,
      originalHeight,
      originalFormat,
      originalAnimation,
      animation: outAnimation,
    };
  } finally {
    module.converter_destroy_instance(inst);
  }
}

/**
 * HTML instance pipeline (`satoru_render` direct for svg/pdf, PNG
 * intermediate + `converter_encode` otherwise). Returns `null` when the
 * instance render bindings are absent so the caller can try the legacy
 * fallback (unified `html_to_image` builds its own instance and cannot see
 * pre-resolved resources, so it stays a fallback only).
 */
export async function tryRunHtmlInstance(
  module: HtmlToImageModule,
  htmls: string | string[],
  satoruOpts: Record<string, unknown>,
  defaultFontMap: Record<string, string>,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string> | null> {
  const {
    format,
    quality,
    speed,
    animation,
    width,
    height,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    fmtInt,
    t0,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    deliverReport,
    resolveCtx,
  } = orch;
  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (
    typeof renderBinding !== "function" ||
    typeof encodeBinding !== "function"
  ) {
    return null;
  }
  const loadImage = module.converter_load_image;
  if (typeof loadImage !== "function")
    throw loggedBinding("converter_load_image");
  const sInst = module.satoru_create_instance();
  try {
    const resolveStart = now();
    await resolveHtmlResources(
      module,
      sInst,
      htmls,
      width,
      height,
      baseUrl,
      fontMap ?? defaultFontMap,
      userAgent ?? DEFAULT_USER_AGENT,
      fallbackFonts,
      resolveCtx,
    );
    addTime("resolveResources", now() - resolveStart);
    emitLog(LogLevel.Info, "resources resolved");

    if (format === "svg" || format === "pdf") {
      const renderStart = now();
      const out = (await renderBinding(
        sInst,
        htmls,
        width,
        height ?? 0,
        fmtInt,
        satoruOpts,
      )) as Uint8Array | null | undefined;
      addTime("render", now() - renderStart);
      if (out == null) {
        throw logged("wasm-html-to-image: satoru_render returned null");
      }
      const bytes = new Uint8Array(
        out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
      );
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, `render done: format=${format}`);
      deliverReport();
      if (format === "svg") {
        const svgStr = new TextDecoder().decode(bytes);
        let outHeight = height ?? 0;
        if (outHeight === 0) {
          const matchH = svgStr.match(/height="(\d+(?:\.\d+)?)"/);
          if (matchH) {
            outHeight = Math.round(parseFloat(matchH[1]));
          }
        }
        return {
          data: svgStr,
          width,
          height: outHeight,
          format: "svg",
        };
      }
      return {
        data: bytes,
        width,
        height: height ?? 0,
        format: "pdf",
      };
    }

    const renderStart = now();
    const png = (await renderBinding(
      sInst,
      htmls,
      width,
      height ?? 0,
      FORMAT_INT.png,
      satoruOpts,
    )) as Uint8Array | null | undefined;
    addTime("render", now() - renderStart);
    if (png == null) {
      throw logged("wasm-html-to-image: satoru_render returned null");
    }
    const cInst = module.converter_create_instance();
    try {
      if (!loadImage(cInst, png)) {
        throw logged("wasm-html-to-image: failed to load render output");
      }
      const outWidth = module.converter_get_width?.(cInst) ?? width;
      const outHeight = module.converter_get_height?.(cInst) ?? height ?? 0;
      const outAnimation =
        module.converter_is_animation?.(cInst) ?? animation;
      const outFormat =
        (module.converter_get_format?.(cInst) as OutputFormat) || format;

      const encodeStart = now();
      const out = (await encodeBinding(
        cInst,
        fmtInt,
        quality,
        speed,
        animation,
      )) as Uint8Array | null | undefined;
      addTime("encode", now() - encodeStart);
      if (out == null) {
        throw logged("wasm-html-to-image: failed to encode image");
      }
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, `render done: format=${format}`);
      deliverReport();
      return {
        data: new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        ),
        width: outWidth,
        height: outHeight,
        format: outFormat,
        animation: outAnimation,
      };
    } finally {
      module.converter_destroy_instance(cInst);
    }
  } finally {
    module.satoru_destroy_instance(sInst);
  }
}

/**
 * Legacy fallback for builds without instance render bindings.
 * Returns `null` when the unified binding is absent.
 */
export async function tryRunLegacyFallback(
  module: HtmlToImageModule,
  htmls: string | string[],
  satoruOpts: Record<string, unknown>,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string> | null> {
  const {
    format,
    quality,
    speed,
    animation,
    width,
    height,
    fmtInt,
    t0,
    emitLog,
    logged,
    addTime,
    deliverReport,
  } = orch;
  const unified = module.html_to_image;
  if (typeof unified !== "function") {
    return null;
  }
  const out = (await unified(
    htmls,
    width,
    height ?? 0,
    fmtInt,
    satoruOpts,
    quality,
    speed,
    animation,
  )) as Uint8Array | null | undefined;
  if (out == null) {
    throw logged("wasm-html-to-image: html_to_image returned null");
  }
  const bytes = new Uint8Array(
    out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
  );
  addTime("total", now() - t0);
  emitLog(LogLevel.Info, `render done (legacy): format=${format}`);
  deliverReport();
  return {
    data: format === "svg" ? new TextDecoder().decode(bytes) : bytes,
    width,
    height: height ?? 0,
    format,
  };
}
