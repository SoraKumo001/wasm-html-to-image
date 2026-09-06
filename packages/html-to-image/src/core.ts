import type { HtmlToImageModule } from "./loader.js";
import { importNode } from "./loader.js";
import { buildSatoruOptions, FIT_INT, FORMAT_INT } from "./encode-args.js";
import {
  dataUrlToBytes,
  imageInputToBytes,
  isImageInput,
  toBytes,
} from "./input.js";
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
  | "avif"
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
  /** Encode speed 0-10, mainly for AVIF (encode stage only, default 6). */
  speed?: number;
  /** Keep animation frames where supported (encode stage only). */
  animation?: boolean;
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

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EMOJI_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2";

/**
 * Upstream default font strategy (verbatim from satoru `DEFAULT_FONT_MAP`):
 * generic families resolve to Google Fonts css2 URLs (fetched with a browser
 * UA so woff2 is served); fetched at render time, nothing bundled.
 */
export const DEFAULT_FONT_MAP: Record<string, string> = {
  "sans-serif": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP",
  serif: "https://fonts.googleapis.com/css2?family=Noto+Serif+JP",
  monospace: "https://fonts.googleapis.com/css2?family=M+PLUS+1+Code",
  cursive: "https://fonts.googleapis.com/css2?family=Yuji+Syuku",
  fantasy: "https://fonts.googleapis.com/css2?family=Reggae+One",
  "Noto Color Emoji": EMOJI_URL,
  emoji: EMOJI_URL,
  "Noto Emoji": EMOJI_URL,
  notocoloremoji: EMOJI_URL,
  notoemoji: EMOJI_URL,
};

/** Process-wide fetched-bytes cache (upstream `resourceCache` parity). */
const resourceCache = new Map<string, Uint8Array>();

/** Binding names reported by {@link requireBindingError}. */
export type WasmBindingName =
  | "satoru_render"
  | "converter_encode"
  | "converter_encode_svg"
  | "converter_encode_pdf"
  | "converter_load_image"
  | "html_to_image";

function requireBindingError(name: WasmBindingName): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is required but not exposed by this build ` +
      `(rebuild the unified module; single-WASM only).`,
  );
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

function fileUrlToFsPath(p: string): string {
  if (!p.startsWith("file://")) return p;
  let out = decodeURIComponent(p.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(out)) out = out.slice(1);
  return out;
}

/**
 * Fetch external resource bytes. `data:` URLs resolve inline in C++
 * (`request()`), so they are skipped here. Relative URLs resolve against
 * `baseUrl` (http base via fetch, fs path via node:fs on Node).
 */
async function fetchResourceBytes(
  url: string,
  baseUrl?: string,
  userAgent?: string,
  resolveResource?: ResolveResourceHook,
): Promise<Uint8Array | null> {
  if (url.startsWith("data:")) return null;
  const fallback = (): Promise<Uint8Array | null> =>
    fetchResourceBytesInner(url, baseUrl, userAgent);
  if (resolveResource) {
    try {
      return await resolveResource(url, fallback);
    } catch {
      return null;
    }
  }
  return fallback();
}

/** Built-in resolution behind the `resolveResource` hook (see above). */
async function fetchResourceBytesInner(
  url: string,
  baseUrl?: string,
  userAgent?: string,
): Promise<Uint8Array | null> {
  const headers = userAgent ? { "User-Agent": userAgent } : undefined;
  const fetchBytes = async (target: string): Promise<Uint8Array | null> => {
    const cached = resourceCache.get(target);
    if (cached) return cached;
    try {
      const res = await fetch(target, headers ? { headers } : undefined);
      if (!res.ok) return null;
      const bytes = toBytes(await res.arrayBuffer());
      resourceCache.set(target, bytes);
      return bytes;
    } catch {
      return null;
    }
  };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    return fetchBytes(url);
  }
  if (baseUrl !== undefined) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)) {
      try {
        return await fetchBytes(new URL(url, baseUrl).href);
      } catch {
        return null;
      }
    }
    if (isNodeRuntime()) {
      try {
        const fs =
          await importNode<typeof import("node:fs/promises")>("fs/promises");
        const path = await importNode<typeof import("node:path")>("path");
        const joined = path.join(fileUrlToFsPath(baseUrl), url);
        const cached = resourceCache.get(joined);
        if (cached) return cached;
        // Keep an owning copy: fs Buffers may ride a shared pool.
        const bytes = new Uint8Array(await fs.readFile(joined));
        resourceCache.set(joined, bytes);
        return bytes;
      } catch {
        return null;
      }
    }
    return null;
  }
  if (isNodeRuntime()) {
    try {
      const cached = resourceCache.get(url);
      if (cached) return cached;
      const fs =
        await importNode<typeof import("node:fs/promises")>("fs/promises");
      // Keep an owning copy: fs Buffers may ride a shared pool.
      const bytes = new Uint8Array(await fs.readFile(url));
      resourceCache.set(url, bytes);
      return bytes;
    } catch {
      return null;
    }
  }
  return null;
}

interface PendingResource {
  type: "font" | "image" | "css";
  url: string;
  name: string;
}

/** Parse the `get_pending_resources` binary form (see loader.ts). */
function parsePendingResources(
  bin: Uint8Array | null | undefined,
): PendingResource[] {
  if (!bin || bin.length < 4) return [];
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const dec = new TextDecoder();
  let off = 0;
  const readStr = (): string | null => {
    if (off + 4 > bin.byteLength) return null;
    const len = view.getUint32(off, true);
    off += 4;
    if (off + len > bin.byteLength) return null;
    const s = dec.decode(new Uint8Array(bin.buffer, bin.byteOffset + off, len));
    off += len;
    return s;
  };
  const count = view.getUint32(off, true);
  off += 4;
  const out: PendingResource[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 2 > bin.byteLength) break;
    const typeInt = view.getUint8(off);
    off += 2; // type + redraw_on_ready
    const url = readStr();
    const name = readStr();
    if (readStr() === null || url === null || name === null) break;
    out.push({
      type: typeInt === 2 ? "image" : typeInt === 3 ? "css" : "font",
      url,
      name,
    });
  }
  return out;
}

/** Monotonic-ish clock for timings (satoru parity). */
function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Mutable diagnostics collection state (internal, `diagnostics: true` only). */
interface DiagState {
  resources: ResourceDiagnostic[];
  fonts: FontDiagnostic[];
  warnings: DiagnosticMessage[];
  errors: DiagnosticMessage[];
  totalResourceBytes: number;
  resourceCount: number;
}

/** Resolution context threaded through HTML discovery (internal). */
interface ResolveContext {
  mediaTypeInt: number;
  css?: string;
  fonts?: { name: string; data: Uint8Array }[];
  limits: RenderLimits;
  resolveResource?: ResolveResourceHook;
  diag: DiagState | null;
  t0: number;
  emitLog: (level: LogLevel, message: string) => void;
  /** Accumulate a timing (no-op unless diagnostics are enabled). */
  addTime: (name: string, ms: number) => void;
  /** Throw a timeout error when `limits.timeoutMs` is exceeded. */
  checkTimeout: () => void;
}

/**
 * Protocol/host allow-list check. Returns a block reason, or `null` when
 * allowed. Relative URLs skip the check (satoru parity).
 */
function checkResourceAllowed(
  url: string,
  limits: RenderLimits,
): string | null {
  if (
    !limits.allowedProtocols &&
    !limits.allowedHosts &&
    !limits.blockedHosts
  ) {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    limits.allowedProtocols &&
    !limits.allowedProtocols.includes(parsed.protocol)
  ) {
    return `Protocol ${parsed.protocol} is blocked`;
  }
  if (limits.allowedHosts && !limits.allowedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is not in allowed list`;
  }
  if (limits.blockedHosts && limits.blockedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is blocked`;
  }
  return null;
}

/** Limit-violation code for a block reason (satoru parity). */
function limitCodeForReason(reason: string): string {
  if (reason.startsWith("Protocol "))
    return DIAGNOSTIC_CODES.LIMIT_PROTOCOL_BLOCKED;
  return DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED;
}

/**
 * Upstream-style discovery loop: collect pending URLs on the satoru
 * instance, fetch them (file/http), and inject the bytes back, so the
 * subsequent render on the SAME instance sees cached fonts/images.
 * Missing bindings (old builds) skip the loop silently.
 */
async function resolveHtmlResources(
  module: HtmlToImageModule,
  satoruInst: unknown,
  htmls: string | string[],
  width: number,
  height: number | undefined,
  baseUrl: string | undefined,
  fontMap: Record<string, string> | undefined,
  userAgent: string | undefined,
  fallbackFonts: (Uint8Array | ArrayBuffer | string)[] | undefined,
  ctx: ResolveContext,
): Promise<void> {
  const collect = module.satoru_collect_resources;
  const getPending = module.satoru_get_pending_resources;
  const addRes = module.satoru_add_resource;
  if (
    typeof collect !== "function" ||
    typeof getPending !== "function" ||
    typeof addRes !== "function"
  )
    return;
  // Upstream default: generic families resolve via fontMap before discovery.
  if (fontMap) {
    const setFontMap = module.satoru_set_font_map;
    if (typeof setFontMap === "function") {
      (await setFontMap(satoruInst, { ...fontMap })) as unknown;
      ctx.emitLog(LogLevel.Debug, "fontMap applied");
    }
  }
  // Upstream idiom: user-supplied fallback fonts go in before discovery.
  if (fallbackFonts && fallbackFonts.length > 0) {
    const loadFallback = module.satoru_load_fallback_font;
    if (typeof loadFallback === "function") {
      for (const entry of fallbackFonts) {
        try {
          const bytes =
            typeof entry === "string"
              ? entry.startsWith("data:")
                ? dataUrlToBytes(entry)
                : await fetchResourceBytes(
                    entry,
                    baseUrl,
                    userAgent,
                    ctx.resolveResource,
                  )
              : entry instanceof Uint8Array
                ? entry
                : new Uint8Array(entry);
          if (!bytes || bytes.length === 0) continue;
          (await loadFallback(satoruInst, bytes)) as unknown;
          ctx.diag?.fonts.push({
            family: "(fallback)",
            status: "loaded",
            source: typeof entry === "string" ? entry : "(bytes)",
          });
        } catch {
          // Per-font failure is non-fatal; discovery proceeds regardless.
          ctx.diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message: "Failed to load fallback font entry",
          });
        }
      }
    }
  }
  // Named font preloads (`fonts` option), before discovery (satoru parity).
  if (ctx.fonts && ctx.fonts.length > 0) {
    const loadFont = module.satoru_load_font;
    if (typeof loadFont === "function") {
      for (const f of ctx.fonts) {
        try {
          (await loadFont(satoruInst, f.name, f.data)) as unknown;
          ctx.diag?.fonts.push({
            family: f.name,
            status: "loaded",
            source: "fonts option",
          });
        } catch (e) {
          ctx.diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message: e instanceof Error ? e.message : String(e),
            source: f.name,
          });
        }
      }
    }
  }
  // Extra CSS pre-scan (`css` option), before discovery (satoru parity).
  if (ctx.css) {
    const scanCss = module.satoru_scan_css;
    if (typeof scanCss === "function") {
      try {
        (await scanCss(satoruInst, ctx.css)) as unknown;
        ctx.emitLog(LogLevel.Debug, "css pre-scanned");
      } catch (e) {
        ctx.diag?.warnings.push({
          code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
          message: e instanceof Error ? e.message : String(e),
          source: "(css option)",
        });
      }
    }
  }
  // Collect-phase profiling (merged into timings when diagnostics on).
  const setProfile = module.satoru_set_collect_profile_enabled;
  const profileEnabled = ctx.diag !== null && typeof setProfile === "function";
  if (profileEnabled) {
    try {
      (await setProfile(satoruInst, true)) as unknown;
    } catch {
      // Non-fatal; timings simply miss the C++ breakdown.
    }
  }
  const list = Array.isArray(htmls) ? htmls : [htmls];
  for (let round = 0; round < 10; round++) {
    ctx.checkTimeout();
    let progressed = false;
    for (const html of list) {
      (await collect(
        satoruInst,
        html,
        width,
        height ?? 0,
        ctx.mediaTypeInt,
      )) as unknown;
      const bin = (await getPending(satoruInst)) as
        | Uint8Array
        | null
        | undefined;
      const pending = parsePendingResources(
        bin instanceof Uint8Array ? bin : undefined,
      );
      if (pending.length === 0) continue;
      progressed = true;
      await Promise.all(
        pending.map(async (r) => {
          const diag = ctx.diag;
          const entry: ResourceDiagnostic | undefined = diag
            ? {
                type: r.type,
                url: r.url,
                name: r.name || undefined,
                status: "pending",
              }
            : undefined;
          if (diag && entry) diag.resources.push(entry);
          const settle = (
            status: ResourceDiagnostic["status"],
            bytes?: number,
            reason?: string,
          ): void => {
            if (!entry) return;
            entry.status = status;
            if (bytes !== undefined) entry.bytes = bytes;
            if (reason !== undefined) entry.reason = reason;
          };
          const skipWithError = (code: string, message: string): void => {
            settle("skipped", undefined, message);
            diag?.errors.push({ code, message, source: r.url });
            ctx.emitLog(LogLevel.Warning, `${message} (${r.url})`);
          };
          try {
            if (r.url.startsWith("data:")) {
              // Inline data: URLs resolve inside C++; nothing to fetch.
              settle("skipped", undefined, "inline data URL (resolved in C++)");
              return;
            }
            if (
              ctx.limits.maxResourceCount !== undefined &&
              diag &&
              diag.resourceCount >= ctx.limits.maxResourceCount
            ) {
              const message = `Maximum resource count (${ctx.limits.maxResourceCount}) exceeded`;
              skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT, message);
              return;
            }
            const blocked = checkResourceAllowed(r.url, ctx.limits);
            if (blocked) {
              skipWithError(limitCodeForReason(blocked), blocked);
              return;
            }
            const bytes = await fetchResourceBytes(
              r.url,
              baseUrl,
              userAgent,
              ctx.resolveResource,
            );
            if (!bytes) {
              settle("failed");
              const message = `Failed to fetch resource: ${r.url}`;
              diag?.warnings.push({
                code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
                message,
                source: r.url,
              });
              ctx.emitLog(LogLevel.Warning, message);
              return;
            }
            if (
              ctx.limits.maxResourceBytes !== undefined &&
              bytes.length > ctx.limits.maxResourceBytes
            ) {
              const message =
                `Resource size (${bytes.length} bytes) exceeds limit ` +
                `(${ctx.limits.maxResourceBytes})`;
              skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE, message);
              return;
            }
            if (
              ctx.limits.maxTotalResourceBytes !== undefined &&
              diag &&
              diag.totalResourceBytes + bytes.length >
                ctx.limits.maxTotalResourceBytes
            ) {
              const message = `Total resource size exceeds limit (${ctx.limits.maxTotalResourceBytes})`;
              skipWithError(DIAGNOSTIC_CODES.LIMIT_TOTAL_SIZE, message);
              return;
            }
            if (diag) {
              diag.resourceCount++;
              diag.totalResourceBytes += bytes.length;
            }
            settle("loaded", bytes.length);
            (await addRes(
              satoruInst,
              r.url,
              r.type === "image" ? 2 : r.type === "css" ? 3 : 1,
              bytes,
            )) as unknown;
            if (r.type === "font") {
              diag?.fonts.push({
                family: r.name || r.url,
                status: "loaded",
                source: r.url,
              });
            }
          } catch (e) {
            // Per-resource failure is non-fatal; render proceeds regardless.
            const message = e instanceof Error ? e.message : String(e);
            settle("failed", undefined, message);
            diag?.warnings.push({
              code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
              message,
              source: r.url,
            });
          }
        }),
      );
    }
    if (!progressed) break;
  }
  // Merge the C++ collect-phase breakdown into the JS timings.
  if (profileEnabled && ctx.diag) {
    const getProfile = module.satoru_get_collect_profile;
    if (typeof getProfile === "function") {
      try {
        const parsed = JSON.parse(
          (await getProfile(satoruInst)) as string,
        ) as Record<string, number>;
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "number") {
            ctx.addTime(key, value);
          }
        }
      } catch {
        // Non-fatal; timings simply miss the C++ breakdown.
      }
    }
  }
}

/**
 * Render HTML — or convert an image — through the single unified WASM
 * module. Image input skips the render stage and goes straight to
 * `converter_encode`. Returns bytes (`Uint8Array`); only `svg` resolves
 * to `string`.
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
  emitLog(LogLevel.Info, `render start: format=${format} width=${width}`);

  // ---- Image input: skip rendering, straight to converter_* ----
  if (isImageInput(value)) {
    const loadImage = module.converter_load_image;
    if (typeof loadImage !== "function")
      throw loggedBinding("converter_load_image");
    const bytes = imageInputToBytes(value as string | Uint8Array | ArrayBuffer);
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
            out instanceof Uint8Array
              ? out
              : new Uint8Array(out as ArrayBuffer),
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

  // ---- HTML input: resolve resources on the instance, then render ----
  // (unified `html_to_image` builds its own instance internally and cannot
  // see pre-resolved fonts/images, so it is only a legacy fallback here).
  if (format === "none") {
    throw logged(
      "wasm-html-to-image: 'none' format is only supported for image inputs",
    );
  }
  let htmls: string | string[];

  if (value !== undefined) {
    htmls = value as string | string[];
  } else if (typeof url === "string") {
    const headers = { "User-Agent": userAgent ?? DEFAULT_USER_AGENT };
    const fetchStart = now();
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
  } else {
    throw logged(
      "wasm-html-to-image: either 'value' or 'url' must be provided.",
    );
  }
  const satoruOpts: Record<string, unknown> = {
    ...buildSatoruOptions(crop, fit),
    svgTextToPaths: textToPaths ?? true,
    mediaType: mediaTypeInt,
    pdfTitle: pdfTitle ?? "",
    pdfAuthor: pdfAuthor ?? "",
    pdfSubject: pdfSubject ?? "",
    pdfKeywords: pdfKeywords ?? "",
    pdfCreator: pdfCreator ?? "",
    pdfProducer: pdfProducer ?? "",
    pdfMarginTop: pdfMargin?.top ?? 0,
    pdfMarginRight: pdfMargin?.right ?? 0,
    pdfMarginBottom: pdfMargin?.bottom ?? 0,
    pdfMarginLeft: pdfMargin?.left ?? 0,
    pdfHeader: pdfHeader ?? "",
    pdfFooter: pdfFooter ?? "",
  };

  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (
    typeof renderBinding === "function" &&
    typeof encodeBinding === "function"
  ) {
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
        fontMap ?? DEFAULT_FONT_MAP,
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
            out instanceof Uint8Array
              ? out
              : new Uint8Array(out as ArrayBuffer),
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

  // Legacy fallback for builds without instance render bindings.
  const unified = module.html_to_image;
  if (typeof unified === "function") {
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
  throw loggedBinding("satoru_render");
}
