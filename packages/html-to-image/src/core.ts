import type { RenderOptions } from "satoru-render";
import type {
  OptimizeParams,
  OptimizeResult,
} from "wasm-image-optimization";
import type { HtmlToImageModule } from "wasm-html-to-image-wasm";

/**
 * Final output formats supported by the integrated SDK.
 *
 * - `svg` / `pdf`: rendered directly by satoru (single stage).
 * - `png` / `jpeg` / `webp` / `avif` / `raw` / `thumbhash`:
 *   satoru renders a PNG intermediate, then wasm-image-optimization
 *   encodes it to the target format (two stages).
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
 * Minimal structural interface of the render stage.
 * Satisfied by `Satoru` from `satoru-render`, `satoru-render/index`,
 * `satoru-render/single` (same `render` overloads as `SatoruBase.render`).
 */
export interface HtmlRenderer {
  render(
    options: RenderOptions & { format: "png" | "webp" | "pdf" },
  ): Promise<Uint8Array>;
  render(options: RenderOptions & { format?: "svg" }): Promise<string>;
  render(options: RenderOptions): Promise<string | Uint8Array>;
}

/**
 * Minimal structural interface of the encode stage.
 * Satisfied by `ImageConverter` from `wasm-image-optimization`
 * (`ImageConverterBase.optimizeImage`).
 */
export interface ImageOptimizer {
  optimizeImage(params: OptimizeParams): Promise<OptimizeResult>;
}

export interface HtmlToImageDeps {
  renderer: HtmlRenderer;
  optimizer: ImageOptimizer;
}

/**
 * Render options: satoru `RenderOptions` (layout, resources, crop/fit,
 * PDF metadata, limits, diagnostics, ...) plus the integrated output
 * format and encode-stage knobs.
 *
 * NOTE (Phase 1): resize/crop/fit are applied in the satoru render stage.
 * The encode stage only encodes (`format`/`quality`/`speed`); `width` /
 * `height` / `crop` / `fit` of `OptimizeParams` are intentionally not
 * re-applied to avoid double resizing.
 */
export interface HtmlToImageOptions extends Omit<RenderOptions, "format"> {
  format?: OutputFormat;
  /** Encode quality 0-100 (encode stage only, default: optimizer default). */
  quality?: number;
  /** Encode speed 0-10, mainly for AVIF (encode stage only). */
  speed?: number;
}

type EncodeFormat = NonNullable<OptimizeParams["format"]>;

/**
 * Render HTML to an image.
 *
 * - `svg` / `pdf` → satoru direct output (single stage).
 * - `png` / `jpeg` / `webp` / `avif` / `raw` / `thumbhash` →
 *   satoru PNG intermediate → `optimizeImage` encode (two stages).
 */
export async function htmlToImage(
  deps: HtmlToImageDeps,
  options: HtmlToImageOptions & { format: "svg" },
): Promise<string>;
export async function htmlToImage(
  deps: HtmlToImageDeps,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
export async function htmlToImage(
  deps: HtmlToImageDeps,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string> {
  const { format = "png", quality, speed, ...renderRest } = options;

  // Single stage: formats natively supported by satoru.
  if (format === "svg" || format === "pdf") {
    return deps.renderer.render({ ...renderRest, format } as RenderOptions);
  }

  // Two stages: PNG intermediate, then encode to the target format.
  const intermediate = (await deps.renderer.render({
    ...renderRest,
    format: "png",
  })) as Uint8Array;
  const { data } = await deps.optimizer.optimizeImage({
    image: intermediate,
    format: format as EncodeFormat,
    quality,
    speed,
  });
  return data;
}

/**
 * Image-to-image conversion passthrough to `optimizeImage`
 * (no HTML rendering involved).
 */
export async function convertImage(
  optimizer: ImageOptimizer,
  params: OptimizeParams,
): Promise<OptimizeResult> {
  return optimizer.optimizeImage(params);
}

// ---- Single-WASM connection (unified module) ----
//
// Primary path: ONE module instance (`HtmlToImageModule` from
// `wasm-html-to-image-wasm`) shared by the render and encode stages.
// Route selection at runtime:
//
// 1. Bitmap-direct (WASM-internal, no PNG intermediate through JS):
//    used when the module exposes the unified `html_to_image` binding
//    (C++ `render_bitmap_to_encoded` exposed to JS — Phase 2, C++ lane).
// 2. Single-module 2-call (current builds): `satoru_render` → PNG →
//    `converter_encode` sharing one module instance. Same call count as the
//    legacy path, but a single WASM binary / single connection.
// 3. Legacy 2-package fallback: `htmlToImage(deps, …)` with caller-provided
//    `satoru-render` + `wasm-image-optimization` instances (kept, see
//    `createDeps()` in `./index.js`). Used when the Phase-2 `satoru_render` /
//    `converter_encode` wrappers are not yet registered in `src/cpp/main.cpp`
//    (which currently binds only instance lifecycle + log level).

/** Single-WASM connection handle (one unified module instance). */
export interface SingleWasmConnection {
  module: HtmlToImageModule;
}

function missingBindingError(
  name: "satoru_render" | "converter_encode",
): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is not exposed by this build ` +
      `(src/cpp/main.cpp currently registers only instance lifecycle + log level). ` +
      `Use the legacy 2-package fallback via createDeps().`,
  );
}

/**
 * `HtmlRenderer` backed by the unified module's `satoru_render` binding
 * (Phase 2). Throws a descriptive error on builds without the binding.
 */
export class SingleWasmRenderer implements HtmlRenderer {
  constructor(private readonly module: HtmlToImageModule) {}
  async render(
    options: RenderOptions & { format: "png" | "webp" | "pdf" },
  ): Promise<Uint8Array>;
  async render(
    options: RenderOptions & { format?: "svg" },
  ): Promise<string>;
  async render(options: RenderOptions): Promise<string | Uint8Array>;
  async render(options: RenderOptions): Promise<string | Uint8Array> {
    const binding = this.module.satoru_render;
    if (typeof binding !== "function") throw missingBindingError("satoru_render");
    const out = await (
      binding as (opts: unknown) => Promise<string | Uint8Array>
    ).call(this.module, { ...options });
    return out;
  }
}

/**
 * `ImageOptimizer` backed by the unified module's `converter_encode` binding
 * (Phase 2). Throws a descriptive error on builds without the binding.
 */
export class SingleWasmOptimizer implements ImageOptimizer {
  constructor(private readonly module: HtmlToImageModule) {}
  async optimizeImage(params: OptimizeParams): Promise<OptimizeResult> {
    const binding = this.module.converter_encode;
    if (typeof binding !== "function")
      throw missingBindingError("converter_encode");
    return (
      binding as (p: unknown) => Promise<OptimizeResult>
    ).call(this.module, { ...params });
  }
}

/** Assemble the 2-stage orchestrator on top of ONE unified module. */
export function createSingleDeps(
  module: HtmlToImageModule,
): HtmlToImageDeps {
  return {
    renderer: new SingleWasmRenderer(module),
    optimizer: new SingleWasmOptimizer(module),
  };
}

/**
 * Render HTML to an image through the single-WASM connection.
 *
 * - Unified `html_to_image` binding present → Bitmap-direct single call
 *   (PNG intermediate never crosses into JS).
 * - Otherwise → single-module 2-call via `createSingleDeps()` + `htmlToImage()`
 *   (needs the Phase-2 `satoru_render` / `converter_encode` wrappers;
 *   without them it throws and the caller should use legacy `createDeps()`).
 */
export async function htmlToImageSingle(
  module: HtmlToImageModule,
  options: HtmlToImageOptions & { format: "svg" },
): Promise<string>;
export async function htmlToImageSingle(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
export async function htmlToImageSingle(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string> {
  const unified = module.html_to_image;
  if (typeof unified === "function") {
    const { format = "png", ...rest } = options;
    return (unified as (o: unknown) => Promise<Uint8Array | string>).call(
      module,
      { ...rest, format },
    );
  }
  return htmlToImage(createSingleDeps(module), options);
}
