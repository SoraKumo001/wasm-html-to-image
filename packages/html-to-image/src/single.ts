/**
 * Single-WASM entry point.
 *
 * Loads the unified `html-to-image` module once (local `./loader.js`)
 * and reuses the single connection for all calls:
 * - unified `html_to_image` binding present -> Bitmap-direct single call;
 * - otherwise -> 2-call on the same module (`satoru_render` -> `converter_encode`).
 */
import {
  loadHtmlToImageModule,
  type HtmlToImageModule,
} from "./loader.js";
import {
  htmlToImage,
  convertImage as convertImageWithModule,
  type HtmlToImageOptions,
  type OptimizeParams,
  type OptimizeResult,
} from "./core.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  OptimizeParams,
  OptimizeResult,
  SingleWasmConnection,
} from "./core.js";
export type { HtmlToImageModule } from "./loader.js";

let cachedModule: HtmlToImageModule | null = null;

/** Lazily load (and reuse) the unified module. */
export async function getDefaultModule(): Promise<HtmlToImageModule> {
  if (!cachedModule) cachedModule = await loadHtmlToImageModule();
  return cachedModule;
}

/**
 * Render HTML to an image with the default single-WASM connection.
 * `svg` resolves to `string`, other formats to `Uint8Array`.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
): Promise<string>;
export async function render(
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
export async function render(
  options: HtmlToImageOptions,
): Promise<Uint8Array | string> {
  return htmlToImage(await getDefaultModule(), options);
}

/** Image-to-image conversion with the default single-WASM connection. */
export async function convertImage(
  params: OptimizeParams,
): Promise<OptimizeResult> {
  return convertImageWithModule(await getDefaultModule(), params);
}
