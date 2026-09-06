/**
 * Single-WASM entry point.
 *
 * Loads the unified `html-to-image` module once (local `./loader.js`)
 * and reuses the single connection for all calls.
 * `render()` accepts HTML (`string` / `string[]` / URL) or image input
 * (`Uint8Array` / `ArrayBuffer` / `data:image/` URL); image input skips
 * rendering and goes straight to `converter_encode`.
 */
import { loadHtmlToImageModule, type HtmlToImageModule } from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
  type RenderResult,
} from "./core.js";
import { isImageInput } from "./input.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  RenderResult,
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./core.js";
export { DIAGNOSTIC_CODES, LogLevel, htmlToImage } from "./core.js";
export { isImageInput };
export type { HtmlToImageModule } from "./loader.js";
export { dropCachedModule, loadHtmlToImageModule } from "./loader.js";

/** Default connection: thin delegation to the loader-owned cache. */
export function getDefaultModule(): Promise<HtmlToImageModule> {
  return loadHtmlToImageModule();
}

/**
 * Render HTML — or convert an image — with the default single-WASM
 * connection. Returns RenderResult containing data and metadata.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export async function render(
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;
export async function render(
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>> {
  return htmlToImage(await getDefaultModule(), options);
}
