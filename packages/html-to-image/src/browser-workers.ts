import { loadWorkerLib } from "./worker-lib-loader.js";
import {
  loadHtmlToImageModule,
  type CreateHtmlToImageModule,
  type HtmlToImageModule,
} from "./loader.js";
import { htmlToImage, type HtmlToImageOptions } from "./core.js";

// @ts-expect-error — dist/html-to-image-single.js is generated at build time
import createHtmlToImageModuleSingle from "../dist/html-to-image-single.js";

const { initWorker } = await loadWorkerLib();

let mod: HtmlToImageModule | undefined;

/** Lazily load (and reuse) the SINGLE_FILE module inside this worker. */
const getModule = async () => {
  if (!mod) {
    mod = await loadHtmlToImageModule({
      factory: createHtmlToImageModuleSingle as CreateHtmlToImageModule,
    });
  }
  return mod;
};

/**
 * Browser worker-side implementation (pre-bundled `dist/web-workers.js`).
 * Mirrors `./child-workers.js`, but the WASM is the SINGLE_FILE build
 * inlined at bundle time, so no `.wasm` fetch/`locateFile` is needed.
 */
const actions = {
  async render(options: HtmlToImageOptions): Promise<Uint8Array | string> {
    return await htmlToImage(await getModule(), options);
  },
};

const map = initWorker(actions);
export type HtmlToImageWorker = typeof map;
