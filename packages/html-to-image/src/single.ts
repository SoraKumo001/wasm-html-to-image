/**
 * Single-WASM entry point (primary).
 *
 * Loads the unified `html-to-image` module once (`wasm-html-to-image-wasm`
 * loader) and reuses the single connection for all calls:
 * - unified `html_to_image` binding present → Bitmap-direct single call;
 * - otherwise → single-module 2-call (`satoru_render` → `converter_encode`).
 *
 * The legacy 2-package orchestration (`satoru-render` +
 * `wasm-image-optimization` via `createDeps()` in `./index.js`) is kept as
 * fallback until the Phase-2 `satoru_*` / `converter_*` value bindings land
 * in `src/cpp/main.cpp`.
 */
import {
  loadHtmlToImageModule,
  type HtmlToImageModule,
} from "wasm-html-to-image-wasm";
import type { OptimizeParams, OptimizeResult } from "wasm-image-optimization";
import {
  createSingleDeps,
  htmlToImageSingle,
  type HtmlToImageDeps,
  type HtmlToImageOptions,
} from "./core.js";

export type {
  OutputFormat,
  HtmlRenderer,
  ImageOptimizer,
  HtmlToImageDeps,
  HtmlToImageOptions,
  SingleWasmConnection,
} from "./core.js";
export type { HtmlToImageModule } from "wasm-html-to-image-wasm";

let cachedModule: HtmlToImageModule | null = null;
let cachedDeps: HtmlToImageDeps | null = null;

/** Lazily load (and reuse) the unified module. */
export async function getDefaultModule(): Promise<HtmlToImageModule> {
  if (!cachedModule) cachedModule = await loadHtmlToImageModule();
  return cachedModule;
}

/**
 * Lazily create (and reuse) the single-connection deps.
 */
export async function getDefaultDeps(): Promise<HtmlToImageDeps> {
  if (!cachedDeps) cachedDeps = createSingleDeps(await getDefaultModule());
  return cachedDeps;
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
  return htmlToImageSingle(await getDefaultModule(), options);
}

/** Image-to-image conversion with the default single-WASM connection. */
export async function convertImage(
  params: OptimizeParams,
): Promise<OptimizeResult> {
  const { optimizer } = await getDefaultDeps();
  return optimizer.optimizeImage(params);
}
