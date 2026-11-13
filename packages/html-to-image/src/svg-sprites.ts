/**
 * External SVG sprite resolution (`<use href="sprite.svg#id">`).
 *
 * Each inline `<svg>` is rendered by SkSVGDOM on its own, which cannot fetch external sprite
 * files or see IDs in another `<svg>` element. When an HTML document contains `<use>` elements
 * referencing an external URL with a fragment (`url#id`), this module fetches up to
 * `MAX_SPRITES` sprite files (via `fetchResourceBytes`, honouring `limits` and `resolveResource`),
 * injects the sprite's definitions into `<defs>` inside each referencing `<svg>`, and rewrites
 * the `<use>` reference to `#id`.
 */
import {
  checkResourceAllowed,
  fetchResourceBytes,
  mapWithLimit,
  now,
  type ResolveContext,
} from "./core-resources.js";

const MAX_SPRITES = 8;
const MAX_SPRITE_BYTES = 2 * 1024 * 1024;
const SPRITE_CONCURRENCY = 4;

interface UseMatch {
  fullMatch: string;
  attrName: string;
  rawUrl: string;
  spriteUrl: string;
  fragmentId: string;
}

const USE_HREF_RE =
  /<use\b[^>]*?\b(xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;

function parseExternalUse(
  tag: string,
  attrName: string,
  raw: string,
): UseMatch | null {
  const hash = raw.indexOf("#");
  if (hash <= 0) return null;
  const spriteUrl = raw.slice(0, hash).trim();
  const fragmentId = raw.slice(hash + 1).trim();
  if (!spriteUrl || !fragmentId || spriteUrl.startsWith("data:")) return null;
  return { fullMatch: tag, attrName, rawUrl: raw, spriteUrl, fragmentId };
}

function extractSvgInner(svgText: string): string | null {
  const open = /<svg\b[^>]*>/i.exec(svgText);
  if (!open) return null;
  const start = open.index + open[0].length;
  const close = svgText.lastIndexOf("</svg>");
  if (close < start) return null;
  return svgText.slice(start, close);
}

function collectIds(svgInner: string): Set<string> {
  const ids = new Set<string>();
  const re = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svgInner)) !== null) {
    const id = m[1] ?? m[2];
    if (id) ids.add(id);
  }
  return ids;
}

async function resolveSinglePageSprites(
  html: string,
  baseUrl: string | undefined,
  userAgent: string | undefined,
  ctx: ResolveContext,
): Promise<string> {
  if (!/<use[\s/>]/i.test(html)) return html;

  const uniqueUrls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  USE_HREF_RE.lastIndex = 0;
  while ((m = USE_HREF_RE.exec(html)) !== null) {
    const raw = m[2] ?? m[3] ?? "";
    const parsed = parseExternalUse(m[0], m[1], raw);
    if (!parsed || seen.has(parsed.spriteUrl)) continue;
    seen.add(parsed.spriteUrl);
    uniqueUrls.push(parsed.spriteUrl);
    if (uniqueUrls.length >= MAX_SPRITES) break;
  }
  if (uniqueUrls.length === 0) return html;

  const sprites = new Map<string, { inner: string; ids: Set<string> }>();
  const maxSpriteBytes = Math.min(
    ctx.limits.maxResourceBytes ?? MAX_SPRITE_BYTES,
    MAX_SPRITE_BYTES,
  );

  await mapWithLimit(uniqueUrls, SPRITE_CONCURRENCY, async (spriteUrl) => {
    let resolved = spriteUrl;
    if (baseUrl && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)) {
      try {
        resolved = new URL(spriteUrl, baseUrl).href;
      } catch {
        return;
      }
    }
    if (checkResourceAllowed(resolved, ctx.limits)) return;
    const timeoutMs =
      ctx.limits.timeoutMs !== undefined
        ? ctx.limits.timeoutMs - (now() - ctx.t0)
        : undefined;
    const bytes = await fetchResourceBytes(
      spriteUrl,
      baseUrl,
      userAgent,
      ctx.resolveResource,
      timeoutMs,
      ctx.limits.confineFilesToBaseUrl,
      { ...ctx.limits, maxResourceBytes: maxSpriteBytes },
    );
    if (!bytes || bytes.length === 0 || bytes.length > maxSpriteBytes) return;
    const text = new TextDecoder().decode(bytes);
    const sanitized = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const inner = extractSvgInner(sanitized);
    if (!inner) return;
    const ids = collectIds(inner);
    if (ids.size === 0) return;
    sprites.set(spriteUrl, { inner, ids });
  });

  if (sprites.size === 0) return html;

  // Rewrite each <svg> block that contains matching external <use> references by
  // injecting the referenced sprite definitions into a leading <defs> inside that <svg>.
  return html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, (svgBlock) => {
    const neededSprites = new Set<string>();
    const rewritten = svgBlock.replace(
      USE_HREF_RE,
      (tag, attrName: string, dq?: string, sq?: string) => {
        const raw = dq ?? sq ?? "";
        const parsed = parseExternalUse(tag, attrName, raw);
        if (!parsed) return tag;
        const sprite = sprites.get(parsed.spriteUrl);
        if (!sprite || !sprite.ids.has(parsed.fragmentId)) return tag;
        neededSprites.add(parsed.spriteUrl);
        const quote = dq !== undefined ? '"' : "'";
        return tag.replace(
          `${attrName}=${quote}${raw}${quote}`,
          `${attrName}=${quote}#${parsed.fragmentId}${quote}`,
        );
      },
    );
    if (neededSprites.size === 0) return svgBlock;
    const defsContent = Array.from(neededSprites)
      .map((u) => sprites.get(u)!.inner)
      .join("");
    return rewritten.replace(/(<svg\b[^>]*>)/i, `$1<defs>${defsContent}</defs>`);
  });
}

/**
 * Resolve external SVG sprite `<use href="sprite.svg#id">` references across one or more HTML pages.
 */
export async function inlineExternalSvgSprites(
  htmls: string | string[],
  baseUrl: string | undefined,
  userAgent: string | undefined,
  ctx: ResolveContext,
): Promise<string | string[]> {
  if (typeof htmls === "string") {
    return resolveSinglePageSprites(htmls, baseUrl, userAgent, ctx);
  }
  return Promise.all(
    htmls.map((h) => resolveSinglePageSprites(h, baseUrl, userAgent, ctx)),
  );
}
