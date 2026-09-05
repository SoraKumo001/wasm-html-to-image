/**
 * Node.js entry point.
 *
 * Two wiring styles (see `core.ts` for the route decision):
 *
 * - Single-WASM (primary): one unified module —
 *   ```ts
 *   import { loadHtmlToImageModule } from "wasm-html-to-image-wasm";
 *   import { createSingleDeps, htmlToImage } from "wasm-html-to-image";
 *
 *   const deps = createSingleDeps(await loadHtmlToImageModule());
 *   const png = await htmlToImage(deps, { value: "<h1>hi</h1>", width: 800 });
 *   // or Bitmap-direct when exposed: htmlToImageSingle(module, {...})
 *   ```
 * - Legacy 2-package fallback: `createDeps()` with caller-provided
 *   `Satoru` / `ImageConverter` (kept until the Phase-2 `satoru_*` /
 *   `converter_*` value bindings land in `src/cpp/main.cpp`).
 *
 * For the zero-config single-WASM build, use `wasm-html-to-image/single`.
 */
export * from "./core.js";
export type { RenderOptions } from "satoru-render";
export type { OptimizeParams, OptimizeResult } from "wasm-image-optimization";
export type { HtmlToImageModule } from "wasm-html-to-image-wasm";
import type { HtmlToImageModule } from "wasm-html-to-image-wasm";
import type {
  HtmlRenderer,
  ImageOptimizer,
  HtmlToImageDeps,
} from "./core.js";
import { createSingleDeps } from "./core.js";

/** Assemble orchestrator dependencies from caller-provided instances (legacy fallback). */
export function createDeps(
  renderer: HtmlRenderer,
  optimizer: ImageOptimizer,
): HtmlToImageDeps {
  return { renderer, optimizer };
}

/** Assemble orchestrator dependencies on top of ONE unified module (primary). */
export function createSingleConnectionDeps(
  module: HtmlToImageModule,
): HtmlToImageDeps {
  return createSingleDeps(module);
}
