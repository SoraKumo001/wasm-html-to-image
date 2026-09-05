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
  loadHtmlToImageModule,
  type EmscriptenModuleArg,
  type HtmlToImageModule,
} from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
  type OptimizeParams,
} from "./core.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  OptimizeParams,
  SingleWasmConnection,
} from "./core.js";
export type {
  HtmlToImageModule,
  EmscriptenModuleArg,
  LoadOptions,
  WasmInstancePtr,
  CreateHtmlToImageModule,
} from "./loader.js";

/** Build the Emscripten module args overriding WASM instantiation. */
function workerdModuleArg(wasm: WebAssembly.Module): EmscriptenModuleArg {
  return {
    instantiateWasm: (imports: unknown, successCallback: unknown) => {
      // Cloudflare Workers requires using the pre-compiled WebAssembly.Module
      WebAssembly.instantiate(wasm, imports as WebAssembly.Imports)
        .then((instance) => {
          (successCallback as (inst: unknown, mod: unknown) => void)(
            instance,
            wasm,
          );
        })
        .catch((e) => {
          console.error(
            "wasm-html-to-image [workerd]: Wasm instantiation failed:",
            e,
          );
        });
      return {}; // Return empty object as emscripten expects
    },
  };
}

let cachedModule: HtmlToImageModule | null = null;

/**
 * Load (and reuse) the unified module on workerd.
 * @param wasm The compiled WASM module (defaults to the bundled one)
 */
export async function getDefaultModule(
  wasm: WebAssembly.Module = htmlToImageWasm,
): Promise<HtmlToImageModule> {
  if (!cachedModule) {
    cachedModule = await loadHtmlToImageModule({
      factory: createHtmlToImageModule,
      moduleArg: workerdModuleArg(wasm),
    });
  }
  return cachedModule;
}

/**
 * Render HTML — or convert an image — on workerd.
 * Returns bytes (`Uint8Array`); only `svg` resolves to `string`.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
  wasm?: WebAssembly.Module,
): Promise<string>;
export async function render(
  options: HtmlToImageOptions,
  wasm?: WebAssembly.Module,
): Promise<Uint8Array | string>;
export async function render(
  options: HtmlToImageOptions,
  wasm?: WebAssembly.Module,
): Promise<Uint8Array | string> {
  return htmlToImage(
    await getDefaultModule(wasm ?? htmlToImageWasm),
    options,
  );
}
