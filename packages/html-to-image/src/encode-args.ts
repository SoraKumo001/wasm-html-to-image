/**
 * Encode-argument conversion (moved verbatim from `./core.ts`; behavior
 * unchanged): WASM int enums and render-option object construction.
 */
import type { HtmlToImageOptions, OutputFormat } from "./core.js";

/** `RenderFormat` enum values (mirrors `bridge_types.h`). */
export const FORMAT_INT: Record<OutputFormat, number> = {
  svg: 0,
  png: 1,
  webp: 2,
  pdf: 3,
  jpeg: 4,
  avif: 5,
  jxl: 8,
  raw: 6,
  thumbhash: 7,
  none: -1,
};

export const FIT_INT: Record<NonNullable<HtmlToImageOptions["fit"]>, number> = {
  contain: 0,
  cover: 1,
  fill: 2,
};

/** Map `crop`/`fit` to satoru render-option fields (`parse_satoru_options`). */
export function buildSatoruOptions(
  crop: HtmlToImageOptions["crop"],
  fit: HtmlToImageOptions["fit"],
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (crop) {
    o.cropX = crop.x;
    o.cropY = crop.y;
    o.cropWidth = crop.width;
    o.cropHeight = crop.height;
  }
  if (fit) o.fitType = FIT_INT[fit];
  return o;
}
