/**
 * Output dimensions recovered from rendered vector bytes, for the cases where
 * the caller left `height` unset (auto) and the WASM render call returns only
 * the encoded document.
 */

/** Height from the root `<svg>` tag only (inner elements also carry `height`). */
export function svgRootHeight(svg: string): number | undefined {
  const root = svg.match(/<svg\b[^>]*>/);
  const h = root?.[0].match(/\sheight="(\d+(?:\.\d+)?)"/);
  return h ? Math.round(parseFloat(h[1])) : undefined;
}

/**
 * Size of the first PDF page, read from its `/MediaBox`. Skia writes page
 * dictionaries uncompressed, so a byte scan is enough; returns `undefined`
 * if no box is found (e.g. a producer that packs pages into object streams).
 */
export function pdfFirstPageSize(
  pdf: Uint8Array,
): { width: number; height: number } | undefined {
  const text = new TextDecoder("latin1").decode(pdf);
  const m = text.match(
    /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/,
  );
  if (!m) return undefined;
  const width = parseFloat(m[3]) - parseFloat(m[1]);
  const height = parseFloat(m[4]) - parseFloat(m[2]);
  return width > 0 && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
}
