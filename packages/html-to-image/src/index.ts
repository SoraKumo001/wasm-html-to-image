/**
 * Node.js entry point (single-WASM only).
 *
 * ```ts
 * import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image";
 *
 * const mod = await loadHtmlToImageModule();
 * const png = await htmlToImage(mod, { value: "<h1>hi</h1>", width: 800 });
 * ```
 *
 * For the zero-config single-WASM build, use `wasm-html-to-image/single`.
 */
export * from "./core.js";
export * from "./loader.js";
