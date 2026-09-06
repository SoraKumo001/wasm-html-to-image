import {
  htmlToImage,
  type HtmlToImageOptions,
  type RenderResult,
} from "./core.js";
import type { HtmlToImageModule } from "./loader.js";

/**
 * Shared worker action table (unified `render` only).
 * `child-workers.ts` (Node) and `browser-workers.ts` (pre-bundled browser
 * worker) differ only in how `getModule` resolves the WASM module.
 */
export function createRenderActions(
  getModule: () => Promise<HtmlToImageModule>,
) {
  return {
    async render(
      options: HtmlToImageOptions,
    ): Promise<RenderResult<Uint8Array | string>> {
      return await htmlToImage(await getModule(), options);
    },
  };
}
