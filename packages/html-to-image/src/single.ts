/**
 * Single-WASM entry point.
 *
 * Loads the unified `html-to-image` module once (local `./loader.js`)
 * and reuses the single connection for all calls.
 * `render()` accepts HTML (`string` / `string[]` / URL) or image input
 * (`Uint8Array` / `ArrayBuffer` / `data:image/` URL); image input skips
 * rendering and goes straight to `converter_encode`.
 */
import {
  loadHtmlToImageModule,
  type HtmlToImageModule,
} from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
} from "./core.js";
import { isImageInput } from "./input.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./core.js";
export { DIAGNOSTIC_CODES, LogLevel } from "./core.js";
export { isImageInput };
export type { HtmlToImageModule } from "./loader.js";
export { dropCachedModule } from "./loader.js";

/** Default connection: thin delegation to the loader-owned cache. */
export function getDefaultModule(): Promise<HtmlToImageModule> {
  return loadHtmlToImageModule();
}

/**
 * Render HTML — or convert an image — with the default single-WASM
 * connection. Returns bytes (`Uint8Array`); only `svg` resolves to `string`.
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
