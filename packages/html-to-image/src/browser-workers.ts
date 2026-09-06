import { loadWorkerLib } from "./worker-lib-loader.js";
import {
  loadHtmlToImageModule,
  type CreateHtmlToImageModule,
  type HtmlToImageModule,
} from "./loader.js";
import { htmlToImage, type HtmlToImageOptions } from "./core.js";
import { loadCompressedWasmBinary } from "./wasm-payload.js";

// @ts-expect-error — dist/html-to-image.js is generated at build time
import createHtmlToImageModule from "../dist/html-to-image.js";

const { initWorker } = await loadWorkerLib();

let mod: HtmlToImageModule | undefined;

/** Lazily load (and reuse) the module inside this worker. */
const getModule = async () => {
  if (!mod) {
    mod = await loadHtmlToImageModule({
      factory: createHtmlToImageModule as CreateHtmlToImageModule,
      moduleArg: { wasmBinary: await loadCompressedWasmBinary() },
    });
  }
  return mod;
};

/**
 * Browser worker-side implementation (pre-bundled `dist/web-workers.js`).
 * Mirrors `./child-workers.js`, but the WASM is the compressed payload
 * (`dist/html-to-image-wasm.js`, restored via `DecompressionStream`) handed
 * to the regular glue as `wasmBinary`, so no `.wasm` fetch/`locateFile`
 * is needed.
 */
const actions = {
  async render(options: HtmlToImageOptions): Promise<Uint8Array | string> {
    return await htmlToImage(await getModule(), options);
  },
};

const map = initWorker(actions);
export type HtmlToImageWorker = typeof map;
