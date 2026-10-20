import { loadWorkerLib } from "./worker-lib-loader.js";
import {
  loadHtmlToImageModule,
  type CreateHtmlToImageModule,
  type HtmlToImageModule,
} from "./loader.js";
import { loadCompressedWasmBinary } from "./wasm-payload.js";
import { createRenderActions } from "./worker-actions.js";

// @ts-expect-error — dist/html-to-image.js is generated at build time
import createHtmlToImageModule from "../dist/html-to-image.js";

const { initWorker } = await loadWorkerLib();

let modPromise: Promise<HtmlToImageModule> | undefined;

/**
 * Lazily load (and reuse) the module inside this worker.
 *
 * The pending promise is shared: parallel jobs arriving while the module
 * is still loading wait for that single load instead of starting a second
 * instantiation (a 12 MB binary plus its linear memory, each). A failed
 * load clears the promise so the next job retries.
 */
const getModule = async (): Promise<HtmlToImageModule> => {
  if (!modPromise) {
    modPromise = (async () => {
      const wasmBinary = await loadCompressedWasmBinary();
      return loadHtmlToImageModule({
        factory: createHtmlToImageModule as CreateHtmlToImageModule,
        moduleArg: { wasmBinary },
      });
    })().catch((e) => {
      modPromise = undefined;
      throw e;
    });
  }
  return modPromise;
};

/**
 * Browser worker-side implementation (pre-bundled `dist/web-workers.js`).
 * Mirrors `./child-workers.js`, but the WASM is the compressed payload
 * (`dist/html-to-image-wasm.js`, restored via `DecompressionStream`) handed
 * to the regular glue as `wasmBinary`, so no `.wasm` fetch/`locateFile`
 * is needed.
 * Canonical `HtmlToImageWorker` type lives in `./workers.js`.
 */
initWorker(createRenderActions(getModule));
export type { HtmlToImageWorker } from "./workers.js";
