import { loadWorkerLib } from "./worker-lib-loader.js";
import { getDefaultModule } from "./single.js";
import { createRenderActions } from "./worker-actions.js";
import type { HtmlToImageModule } from "./loader.js";

const { initWorker } = await loadWorkerLib();

let mod: HtmlToImageModule | undefined;

/** Lazily load (and reuse) the single module inside this worker. */
const getModule = async () => {
  if (!mod) {
    mod = await getDefaultModule();
  }
  return mod;
};

/**
 * Worker-side implementation.
 * Exposes the unified render (HTML and image inputs) via worker-lib.
 * Each worker thread loads its own module instance (modules cannot cross
 * thread boundaries, so nothing is shared with the parent).
 */
const map = initWorker(createRenderActions(getModule));
export type HtmlToImageWorker = typeof map;
