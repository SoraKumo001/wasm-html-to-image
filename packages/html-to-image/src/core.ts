import type { HtmlToImageModule } from "./loader.js";

/**
 * Final output formats. Single-WASM internal routing:
 * - `svg` / `pdf`: satoru render binding direct output.
 * - `png` / `jpeg` / `webp` / `avif` / `raw` / `thumbhash`:
 *   satoru PNG intermediate -> converter encode binding,
 *   or the unified `html_to_image` binding (Bitmap-direct, no JS round-trip).
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
 * Extra keys are passed through to the WASM binding options object.
 */
export interface RenderOptions {
  value?: string | string[];
  url?: string;
  baseUrl?: string;
  width: number;
  height?: number;
  format?: string;
  [key: string]: unknown;
}

/**
 * Render options: layout size, HTML source, plus the integrated output
 * format and encode-stage knobs.
 *
 * NOTE: resize/crop/fit are applied in the render stage. The encode stage
 * only encodes (`format`/`quality`/`speed`).
 */
export interface HtmlToImageOptions extends Omit<RenderOptions, "format"> {
  format?: OutputFormat;
  /** Encode quality 0-100 (encode stage only, default: encoder default). */
  quality?: number;
  /** Encode speed 0-10, mainly for AVIF (encode stage only). */
  speed?: number;
}

/** Encode-stage params (self-defined; no `wasm-image-optimization` dependency). */
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

/** Encode-stage result. */
export type OptimizeResult = {
  data: Uint8Array;
  originalWidth: number;
  originalHeight: number;
  originalAnimation: boolean;
  originalFormat: string;
  width: number;
  height: number;
  animation: boolean;
  format: string;
};

/** Single-WASM connection handle (one unified module instance). */
export interface SingleWasmConnection {
  module: HtmlToImageModule;
}

function requireBindingError(
  name: "satoru_render" | "converter_encode" | "html_to_image",
): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is required but not exposed by this build ` +
      `(rebuild the unified module; single-WASM only, no 2-package fallback).`,
  );
}

/**
 * Render HTML to an image through the single unified WASM module.
 *
 * - Unified `html_to_image` binding present -> Bitmap-direct single call
 *   (PNG intermediate never crosses into JS).
 * - Otherwise -> 2-call on the same module (`satoru_render` -> PNG ->
 *   `converter_encode`). Both bindings are required; missing bindings throw.
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
  const { format = "png", quality, speed, ...rest } = options;
  const unified = module.html_to_image;
  if (typeof unified === "function") {
    return (unified as (o: unknown) => Promise<Uint8Array | string>).call(
      module,
      { ...rest, format, quality, speed },
    );
  }
  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (typeof renderBinding !== "function")
    throw requireBindingError("satoru_render");
  if (typeof encodeBinding !== "function")
    throw requireBindingError("converter_encode");
  if (format === "svg" || format === "pdf") {
    return (renderBinding as (o: unknown) => Promise<Uint8Array | string>).call(
      module,
      { ...rest, format },
    );
  }
  const intermediate = (await (
    renderBinding as (o: unknown) => Promise<Uint8Array>
  ).call(module, { ...rest, format: "png" })) as Uint8Array;
  const encoded = (await (
    encodeBinding as (o: unknown) => Promise<OptimizeResult | Uint8Array>
  ).call(module, { image: intermediate, format, quality, speed })) as
    | OptimizeResult
    | Uint8Array;
  if (encoded instanceof Uint8Array) return encoded;
  return (encoded as OptimizeResult).data;
}

/** Alias kept for callers of the previous single-connection name. */
export const htmlToImageSingle = htmlToImage;

/**
 * Image-to-image conversion through the single unified WASM module
 * (no HTML rendering involved). Requires the `converter_encode` binding.
 */
export async function convertImage(
  module: HtmlToImageModule,
  params: OptimizeParams,
): Promise<OptimizeResult> {
  const encodeBinding = module.converter_encode;
  if (typeof encodeBinding !== "function")
    throw requireBindingError("converter_encode");
  const out = (await (encodeBinding as (p: unknown) => Promise<unknown>).call(
    module,
    { ...params },
  )) as OptimizeResult | Uint8Array;
  if (out instanceof Uint8Array) {
    return {
      data: out,
      originalWidth: 0,
      originalHeight: 0,
      originalAnimation: false,
      originalFormat: "",
      width: 0,
      height: 0,
      animation: false,
      format: params.format ?? "",
    };
  }
  return out as OptimizeResult;
}
