import type { HtmlToImageModule } from "./loader.js";

/**
 * Final output formats. Single-WASM internal routing:
 * - HTML input: unified `html_to_image` binding (Bitmap-direct, no JS
 *   round-trip), or `satoru_render` -> PNG -> `converter_encode` fallback.
 * - Image input: render stage skipped, straight to `converter_encode`
 *   (`converter_load_image` -> optional crop/resize -> `converter_encode`).
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
  format?: string;
}

/**
 * Unified options for HTML and image inputs.
 *
 * - HTML input: `width`/`height` are the layout viewport; `crop`/`fit`
 *   are forwarded to the satoru render options.
 * - Image input: render stage is skipped; `width`/`height`/`crop`/`fit`
 *   are applied as output resize on the encode stage.
 */
export interface HtmlToImageOptions extends Omit<RenderOptions, "format"> {
  format?: OutputFormat;
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
  /** Extra keys are forwarded to the WASM render options object. */
  [key: string]: unknown;
}

/** Encode-stage params (kept for option-shape documentation). */
export type OptimizeParams = {
  image: Uint8Array | ArrayBuffer | string;
  crop?: { x: number; y: number; width: number; height: number };
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill";
  format?: "none" | "png" | "webp" | "jpeg" | "avif" | "raw" | "thumbhash";
  quality?: number;
  speed?: number;
  animation?: boolean;
};

/** Single-WASM connection handle (one unified module instance). */
export interface SingleWasmConnection {
  module: HtmlToImageModule;
}

/** `RenderFormat` enum values (mirrors `bridge_types.h`). */
const FORMAT_INT: Record<OutputFormat, number> = {
  svg: 0,
  png: 1,
  webp: 2,
  pdf: 3,
  jpeg: 4,
  avif: 5,
  raw: 6,
  thumbhash: 7,
};

const FIT_INT: Record<NonNullable<HtmlToImageOptions["fit"]>, number> = {
  contain: 0,
  cover: 1,
  fill: 2,
};

function ascii(
  bytes: Uint8Array,
  start: number,
  end: number,
): string | null {
  if (bytes.length < end) return null;
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Detect a known image container by magic bytes; `null` when unknown. */
function sniffImageFormat(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "webp";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
    return "gif";
  if (
    ascii(bytes, 4, 8) === "ftyp" &&
    (ascii(bytes, 8, 12) === "avif" || ascii(bytes, 8, 12) === "avis")
  )
    return "avif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d)
    return "bmp";
  return null;
}

/**
 * Whether `value` is image input.
 *
 * - Binary (`Uint8Array` / `ArrayBuffer`): magic-byte sniffing for
 *   PNG/JPEG/WebP/GIF/AVIF/BMP. Unknown magic throws.
 * - `string`: `data:image/` prefix means image input; anything else is HTML.
 * - `string[]` (HTML vector) / `undefined`: not image input.
 */
export function isImageInput(value: unknown): boolean {
  if (value === undefined || value === null || Array.isArray(value))
    return false;
  if (typeof value === "string") return value.startsWith("data:image/");
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (bytes === null) {
    throw new Error(
      "wasm-html-to-image: unsupported input type (expected HTML string, data URL, or image bytes)",
    );
  }
  if (sniffImageFormat(bytes) !== null) return true;
  throw new Error(
    `wasm-html-to-image: unrecognized image input (unknown magic bytes, len=${bytes.length})`,
  );
}

function dataUrlToBytes(s: string): Uint8Array {
  const comma = s.indexOf(",");
  if (comma < 0 || !s.startsWith("data:")) {
    throw new Error("wasm-html-to-image: malformed data URL");
  }
  const meta = s.slice(0, comma);
  const body = s.slice(comma + 1);
  if (meta.includes(";base64")) {
    const bin = atob(body.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

/** Normalize image input to raw bytes (data URLs are decoded). */
function imageInputToBytes(
  value: string | Uint8Array | ArrayBuffer,
): Uint8Array {
  if (typeof value === "string") return dataUrlToBytes(value);
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function requireBindingError(
  name:
    | "satoru_render"
    | "converter_encode"
    | "converter_encode_svg"
    | "converter_encode_pdf"
    | "converter_load_image"
    | "html_to_image",
): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is required but not exposed by this build ` +
      `(rebuild the unified module; single-WASM only).`,
  );
}

/** Map `crop`/`fit` to satoru render-option fields (`parse_satoru_options`). */
function buildSatoruOptions(
  crop: HtmlToImageOptions["crop"],
  fit: HtmlToImageOptions["fit"],
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (crop) {
    o.cropX = crop.x;
    o.cropY = crop.y;
    o.cropWidth = crop.width;
    o.cropHeight = crop.height;
  }
  if (fit) o.fitType = FIT_INT[fit];
  return o;
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

  // ---- HTML input: unified binding first, instance 2-call fallback ----
  let htmls: string | string[];
  if (value !== undefined) {
    htmls = value as string | string[];
  } else if (typeof url === "string") {
    const res = await fetch(url);
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

  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (typeof renderBinding !== "function")
    throw requireBindingError("satoru_render");
  if (typeof encodeBinding !== "function")
    throw requireBindingError("converter_encode");
  const loadImage = module.converter_load_image;
  if (typeof loadImage !== "function")
    throw requireBindingError("converter_load_image");

  if (format === "svg" || format === "pdf") {
    const inst = module.satoru_create_instance();
    try {
      const out = (await renderBinding(
        inst,
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
    } finally {
      module.satoru_destroy_instance(inst);
    }
  }

  const sInst = module.satoru_create_instance();
  try {
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
