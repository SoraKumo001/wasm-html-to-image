/**
 * Cloudflare Workers (workerd) entry point.
 *
 * Upstream-compatible pattern (`satoru` / `wasm-image-optimization`
 * `workerd.ts`): the `.wasm` artifact is imported as a pre-compiled
 * `WebAssembly.Module` and instantiation is overridden via
 * `instantiateWasm`, because workerd cannot fetch/compile WASM at runtime.
 *
 * Uses the regular (non-SINGLE_FILE) `dist/html-to-image.wasm`
 * (`SINGLE_FILE` builds cannot be used on Workers).
 *
 * ```ts
 * import wasm from "wasm-html-to-image/html-to-image.wasm"; // optional override
 * import { render } from "wasm-html-to-image/workerd";
 * const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" });
 * ```
 */
// @ts-expect-error — dist/html-to-image.js is generated at build time
import createHtmlToImageModule from "../dist/html-to-image.js";
import htmlToImageWasm from "../dist/html-to-image.wasm";
import {
  dropCachedModule,
  loadPrecompiledModule,
  noteModuleRender,
  type HtmlToImageModule,
} from "./loader.js";
export {
  moduleHeapBytes,
  setModuleRecyclePolicy,
  type ModuleRecyclePolicy,
} from "./loader.js";
import { mermaidRenderOptions, type RenderMermaid } from "./mermaid.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
  type RenderResult,
} from "./core.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  LayoutBox,
  RenderResult,
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./core.js";
export { DIAGNOSTIC_CODES, LogLevel, isImageInput } from "./core.js";
export { clearResourceCache } from "./core-resources.js";
export type {
  HtmlToImageModule,
  EmscriptenModuleArg,
  LoadOptions,
  WasmInstancePtr,
  CreateHtmlToImageModule,
} from "./loader.js";

/** Module instances keyed by WASM binary (cache owned here, loading in loader). */
const moduleByWasm = new Map<WebAssembly.Module, Promise<HtmlToImageModule>>();

/**
 * Load (and reuse) the unified module on workerd.
 * @param wasm The compiled WASM module (defaults to the bundled one)
 */
export function getDefaultModule(
  wasm: WebAssembly.Module = htmlToImageWasm,
): Promise<HtmlToImageModule> {
  return loadPrecompiledModule(
    createHtmlToImageModule,
    wasm,
    moduleByWasm,
    "workerd",
  );
}

/**
 * Drop the cached module instance (for `wasm`, or every one when omitted), so the next render
 * instantiates a fresh one and the old instance's grown Wasm memory can be reclaimed. Renders
 * already in flight keep their instance and finish normally. See {@link ModuleRecyclePolicy}
 * for the automatic form of this.
 */
export function dropModule(wasm?: WebAssembly.Module): void {
  if (wasm) moduleByWasm.delete(wasm);
  else moduleByWasm.clear();
  dropCachedModule();
}

/**
 * Render HTML — or convert an image — on workerd.
 * Returns RenderResult containing data and metadata.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
  wasm?: WebAssembly.Module,
): Promise<RenderResult<string>>;
export async function render(
  options: HtmlToImageOptions,
  wasm?: WebAssembly.Module,
): Promise<RenderResult<Uint8Array | string>>;
export async function render(
  options: HtmlToImageOptions,
  wasm?: WebAssembly.Module,
): Promise<RenderResult<Uint8Array | string>> {
  const key = wasm ?? htmlToImageWasm;
  const module = await getDefaultModule(key);
  try {
    return await htmlToImage(module, options);
  } finally {
    if (noteModuleRender(module)) dropModule(key);
  }
}

export type { MermaidInput, MermaidOptions, MermaidTheme, MermaidWarning, RenderFn, RenderMermaid } from "./mermaid.js";
export { MERMAID_THEMES, mermaidToHtml } from "./mermaid.js";
/** Render a Mermaid diagram as SVG text (default) or an image, with the bundled WASM. */
export const renderMermaid: RenderMermaid = ((source, options) => render(mermaidRenderOptions(source, options))) as RenderMermaid;
