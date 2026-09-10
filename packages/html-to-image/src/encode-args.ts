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

/** Full satoru render-option fields (text, media, PDF metadata). */
export interface FullSatoruOptionsInput {
  crop: HtmlToImageOptions["crop"];
  fit: HtmlToImageOptions["fit"];
  textToPaths?: boolean;
  mediaTypeInt: number;
  pdfTitle?: string;
  pdfAuthor?: string;
  pdfSubject?: string;
  pdfKeywords?: string;
  pdfCreator?: string;
  pdfProducer?: string;
  pdfMargin?: { top?: number; right?: number; bottom?: number; left?: number };
  pdfHeader?: string;
  pdfFooter?: string;
}

/**
 * Canonical full satoru render-option builder (正本はここ).
 * `core.ts` HTML パスはこの関数のみを使い、個別組み立てをしない。
 */
export function buildFullSatoruOptions(
  input: FullSatoruOptionsInput,
): Record<string, unknown> {
  const {
    textToPaths,
    mediaTypeInt,
    pdfTitle,
    pdfAuthor,
    pdfSubject,
    pdfKeywords,
    pdfCreator,
    pdfProducer,
    pdfMargin,
    pdfHeader,
    pdfFooter,
  } = input;
  return {
    ...buildSatoruOptions(input.crop, input.fit),
    svgTextToPaths: textToPaths ?? true,
    mediaType: mediaTypeInt,
    pdfTitle: pdfTitle ?? "",
    pdfAuthor: pdfAuthor ?? "",
    pdfSubject: pdfSubject ?? "",
    pdfKeywords: pdfKeywords ?? "",
    pdfCreator: pdfCreator ?? "",
    pdfProducer: pdfProducer ?? "",
    pdfMarginTop: pdfMargin?.top ?? 0,
    pdfMarginRight: pdfMargin?.right ?? 0,
    pdfMarginBottom: pdfMargin?.bottom ?? 0,
    pdfMarginLeft: pdfMargin?.left ?? 0,
    pdfHeader: pdfHeader ?? "",
    pdfFooter: pdfFooter ?? "",
  };
}
