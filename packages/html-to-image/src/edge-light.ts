/**
 * Edge-light entry point (Next.js Edge runtime, Vercel edge-light).
 *
 * Same engine as `./workerd.js`, but with NO static `.wasm` import:
 * bundlers outside workerd (notably Next.js edge-server compilation) cannot
 * resolve a bare `import wasm from "../dist/html-to-image.wasm"`, so that
 * line would force consumers to add a dedicated `asset/resource` rule.
 * Here the caller always supplies a pre-compiled `WebAssembly.Module`
 * (e.g. compiled from bytes served over HTTP), and instantiation is
 * overridden via `instantiateWasm` exactly like `./workerd.js`.
 *
 * Runtime separation is done in `package.json` `exports` conditions:
 * - `workerd` (Cloudflare) -> `./workerd.js` (static `.wasm` import)
 * - `edge-light` (Next.js Edge) -> `./edge-light.js` (this file)
 * The two conditions never overlap (verified against Next.js 15
 * `edgeConditionNames` and wrangler/miniflare build conditions), and
 * `edge-light` is listed before any `browser` key so Edge resolution wins.
 *
 * ```ts
 * import { render } from "wasm-html-to-image/workerd"; // edge-light resolves here on Edge
 * const wasm = await WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer());
 * const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" }, wasm);
 * ```
 */
// @ts-expect-error — dist/html-to-image.js is generated at build time
import createHtmlToImageModule from "./html-to-image.js";
import {
  loadHtmlToImageModule,
  type EmscriptenModuleArg,
  type HtmlToImageModule,
} from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
} from "./core.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
} from "./core.js";
export type {
  HtmlToImageModule,
  EmscriptenModuleArg,
  LoadOptions,
  WasmInstancePtr,
  CreateHtmlToImageModule,
} from "./loader.js";

/** Build the Emscripten module args overriding WASM instantiation. */
function edgeModuleArg(wasm: WebAssembly.Module): EmscriptenModuleArg {
  return {
    instantiateWasm: (imports: unknown, successCallback: unknown) => {
      WebAssembly.instantiate(wasm, imports as WebAssembly.Imports)
        .then((instance) => {
          (successCallback as (inst: unknown, mod: unknown) => void)(
            instance,
            wasm,
          );
        })
        .catch((e) => {
          console.error(
            "wasm-html-to-image [edge-light]: Wasm instantiation failed:",
            e,
          );
        });
      return {}; // Return empty object as emscripten expects
    },
  };
}

/** Module instances keyed by WASM binary: a second call with a different
 * `wasm` must not silently reuse the first one. Failed loads are evicted
 * so a later call can retry. */
const moduleByWasm = new Map<WebAssembly.Module, Promise<HtmlToImageModule>>();

/**
 * Load (and reuse) the unified module for a pre-compiled `WebAssembly.Module`.
 * @param wasm The compiled WASM module (always required — no bundled default)
 */
export function getDefaultModule(
  wasm: WebAssembly.Module,
): Promise<HtmlToImageModule> {
  let pending = moduleByWasm.get(wasm);
  if (!pending) {
    pending = loadHtmlToImageModule({
      factory: createHtmlToImageModule,
      moduleArg: edgeModuleArg(wasm),
    });
    moduleByWasm.set(wasm, pending);
    pending.catch(() => {
      if (moduleByWasm.get(wasm) === pending) moduleByWasm.delete(wasm);
    });
  }
  return pending;
}

/**
 * Render HTML — or convert an image — on an edge runtime.
 * Returns bytes (`Uint8Array`); only `svg` resolves to `string`.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
  wasm: WebAssembly.Module,
): Promise<string>;
export async function render(
  options: HtmlToImageOptions,
  wasm: WebAssembly.Module,
): Promise<Uint8Array | string>;
export async function render(
  options: HtmlToImageOptions,
  wasm: WebAssembly.Module,
): Promise<Uint8Array | string> {
  return htmlToImage(
    await getDefaultModule(wasm),
    options,
  );
}
