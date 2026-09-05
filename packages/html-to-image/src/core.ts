import type { HtmlToImageModule } from "./loader.js";
import { buildSatoruOptions, FIT_INT, FORMAT_INT } from "./encode-args.js";
import { dataUrlToBytes, imageInputToBytes, isImageInput, toBytes } from "./input.js";

// Backward compatibility: `isImageInput` now lives in `./input.js` but
// stays importable from here (and therefore from the package root).
export { isImageInput };

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
  | "thumbhash";

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
): Promise<Uint8Array | null> {
  if (url.startsWith("data:")) return null;
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
        const fs = await import(/* @vite-ignore */ "node:fs/promises");
        const path = await import(/* @vite-ignore */ "node:path");
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
      const fs = await import(/* @vite-ignore */ "node:fs/promises");
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
function parsePendingResources(bin: Uint8Array | null | undefined): PendingResource[] {
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
                : await fetchResourceBytes(entry, baseUrl, userAgent)
              : entry instanceof Uint8Array
                ? entry
                : new Uint8Array(entry);
          if (!bytes || bytes.length === 0) continue;
          (await loadFallback(satoruInst, bytes)) as unknown;
        } catch {
          // Per-font failure is non-fatal; discovery proceeds regardless.
        }
      }
    }
  }
  const list = Array.isArray(htmls) ? htmls : [htmls];
  for (let round = 0; round < 10; round++) {
    let progressed = false;
    for (const html of list) {
      (await collect(satoruInst, html, width, height ?? 0, 0)) as unknown;
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
          try {
            const bytes = await fetchResourceBytes(r.url, baseUrl, userAgent);
            if (!bytes) return;
            (await addRes(
              satoruInst,
              r.url,
              r.type === "image" ? 2 : r.type === "css" ? 3 : 1,
              bytes,
            )) as unknown;
          } catch {
            // Per-resource failure is non-fatal; render proceeds regardless.
          }
        }),
      );
    }
    if (!progressed) break;
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
): Promise<string>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string> {
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
  } = options;
  const fmtInt = FORMAT_INT[format];

  // ---- Image input: skip rendering, straight to converter_* ----
  if (isImageInput(value)) {
    const loadImage = module.converter_load_image;
    if (typeof loadImage !== "function")
      throw requireBindingError("converter_load_image");
    const bytes = imageInputToBytes(value as string | Uint8Array | ArrayBuffer);
    const inst = module.converter_create_instance();
    try {
      if (!loadImage(inst, bytes)) {
        throw new Error(
          "wasm-html-to-image: failed to load image input (unsupported or corrupt)",
        );
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
      if (format === "svg") {
        const svgBinding = module.converter_encode_svg;
        if (typeof svgBinding !== "function")
          throw requireBindingError("converter_encode_svg");
        const svg = (await svgBinding(inst)) as string;
        if (!svg) {
          throw new Error("wasm-html-to-image: failed to encode image to svg");
        }
        return svg;
      }
      if (format === "pdf") {
        const pdfBinding = module.converter_encode_pdf;
        if (typeof pdfBinding !== "function")
          throw requireBindingError("converter_encode_pdf");
        const out = (await pdfBinding(inst)) as
          | Uint8Array
          | null
          | undefined;
        if (out == null) {
          throw new Error("wasm-html-to-image: failed to encode image to pdf");
        }
        return new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        );
      }
      const encodeBinding = module.converter_encode;
      if (typeof encodeBinding !== "function")
        throw requireBindingError("converter_encode");
      const out = (await encodeBinding(
        inst,
        fmtInt,
        quality,
        speed,
        animation,
      )) as Uint8Array | null | undefined;
      if (out == null) {
        throw new Error("wasm-html-to-image: failed to encode image");
      }
      return new Uint8Array(
        out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
      );
    } finally {
      module.converter_destroy_instance(inst);
    }
  }

  // ---- HTML input: resolve resources on the instance, then render ----
  // (unified `html_to_image` builds its own instance internally and cannot
  // see pre-resolved fonts/images, so it is only a legacy fallback here).
  let htmls: string | string[];
  if (value !== undefined) {
    htmls = value as string | string[];
  } else if (typeof url === "string") {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent ?? DEFAULT_USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(
        `wasm-html-to-image: failed to fetch HTML from URL: ${url} (${res.status})`,
      );
    }
    htmls = await res.text();
  } else {
    throw new Error("wasm-html-to-image: either 'value' or 'url' must be provided.");
  }
  const satoruOpts = buildSatoruOptions(crop, fit);

  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (
    typeof renderBinding === "function" &&
    typeof encodeBinding === "function"
  ) {
    const loadImage = module.converter_load_image;
    if (typeof loadImage !== "function")
      throw requireBindingError("converter_load_image");
    const sInst = module.satoru_create_instance();
    try {
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
      );

      if (format === "svg" || format === "pdf") {
        const out = (await renderBinding(
          sInst,
          htmls,
          width,
          height ?? 0,
          fmtInt,
          satoruOpts,
        )) as Uint8Array | null | undefined;
        if (out == null) {
          throw new Error("wasm-html-to-image: satoru_render returned null");
        }
        const bytes = new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        );
        return format === "svg" ? new TextDecoder().decode(bytes) : bytes;
      }

      const png = (await renderBinding(
        sInst,
        htmls,
        width,
        height ?? 0,
        FORMAT_INT.png,
        satoruOpts,
      )) as Uint8Array | null | undefined;
      if (png == null) {
        throw new Error("wasm-html-to-image: satoru_render returned null");
      }
      const cInst = module.converter_create_instance();
      try {
        if (!loadImage(cInst, png)) {
          throw new Error("wasm-html-to-image: failed to load render output");
        }
        const out = (await encodeBinding(
          cInst,
          fmtInt,
          quality,
          speed,
          animation,
        )) as Uint8Array | null | undefined;
        if (out == null) {
          throw new Error("wasm-html-to-image: failed to encode image");
        }
        return new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        );
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
      throw new Error("wasm-html-to-image: html_to_image returned null");
    }
    const bytes = new Uint8Array(
      out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
    );
    return format === "svg" ? new TextDecoder().decode(bytes) : bytes;
  }
  throw requireBindingError("satoru_render");
}
