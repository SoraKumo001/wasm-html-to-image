/**
 * Resource layer split from `./core.ts` (behavior unchanged).
 *
 * Owns: fetched-bytes cache, `fetchResourceBytes`, pending-resources
 * parsing, allow-list checks, and the `resolveHtmlResources` discovery loop.
 * Orchestration context types (`DiagState`, `ResolveContext`) live here so
 * both the loop and the orchestration/pipeline layer share them.
 */
import { importNode, type HtmlToImageModule } from "./loader.js";
import type { ImageResourceRecord } from "wasm-quickjs-dom";
import { dataUrlToBytes, toBytes } from "./input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  errorToDiagnostic,
  type DiagnosticMessage,
  type FontDiagnostic,
  type RenderLimits,
  type ResolveResourceHook,
  type ResourceDiagnostic,
} from "./diagnostics.js";

/** Cache bounds: tighter on Edge/Workers (small isolate memory) than on Node servers. */
const CACHE_MAX_ENTRIES = isNodeRuntime() ? 256 : 128;
const CACHE_MAX_BYTES = (isNodeRuntime() ? 64 : 16) * 1024 * 1024;

/**
 * Process-wide fetched-bytes cache (upstream `resourceCache` parity),
 * bounded by entry count and total bytes with least-recently-used eviction.
 */
class ResourceCache {
  private readonly map = new Map<string, Uint8Array>();
  private bytes = 0;

  get(key: string): Uint8Array | undefined {
    const hit = this.map.get(key);
    if (hit) {
      // Re-insert so Map order tracks recency (oldest first).
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Uint8Array): void {
    if (value.length > CACHE_MAX_BYTES) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.map) {
      if (this.map.size <= CACHE_MAX_ENTRIES && this.bytes <= CACHE_MAX_BYTES) {
        break;
      }
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

const resourceCache = new ResourceCache();

/** Drop every cached resource (e.g. after the source assets changed). */
export function clearResourceCache(): void {
  resourceCache.clear();
}

export function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

/**
 * Whether `fetch` may send a `User-Agent` of our choosing: Node and Cloudflare Workers can; browsers
 * cannot (and Firefox preflights it, which breaks Google Fonts / jsDelivr CORS). The UA decides what
 * Google Fonts serves: a browser UA gets woff2 split by unicode-range (a few KB per page), anything
 * else (a Worker's own UA, none) gets the whole `.ttf` per weight (about 5 MB each, embedded whole
 * into a PDF).
 */
/** True on Cloudflare Workers: workerd reports exactly this user agent. */
export function isCloudflareWorkersRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

export function canSetUserAgent(): boolean {
  if (isNodeRuntime()) return true;
  return isCloudflareWorkersRuntime();
}

function fileUrlToFsPath(p: string): string {
  if (!p.startsWith("file://")) return p;
  let out = decodeURIComponent(p.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(out)) out = out.slice(1);
  return out;
}

const MAX_REDIRECTS = 10;

/** Error thrown when a fetch violates `RenderLimits` (redirect target or streaming size). */
export class FetchLimitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FetchLimitError";
  }
}

/** True for localhost and private, loopback and link-local addresses (`host` as `URL.hostname` gives it). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) {
      return true;
    }
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (dotted) return isPrivateHost(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isPrivateHost(
        [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."),
      );
    }
  }
  return false;
}

/**
 * Fetch `target` while checking every redirect hop against `limits`.
 * Cancels ignored redirect bodies so `workerd` never leaks open streams.
 */
export async function fetchWithLimits(
  target: string,
  init: RequestInit,
  limits?: RenderLimits,
): Promise<Response> {
  const restricted = !!(
    limits?.allowedProtocols ||
    limits?.allowedHosts ||
    limits?.blockedHosts ||
    limits?.blockPrivateHosts
  );
  if (!restricted) {
    return fetch(target, init);
  }
  let currentUrl = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = checkResourceAllowed(currentUrl, limits!);
    if (blocked) {
      throw new FetchLimitError(limitCodeForReason(blocked), blocked);
    }
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (res.type === "opaqueredirect") {
      try {
        await res.body?.cancel?.();
      } catch {}
      throw new FetchLimitError(
        DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED,
        `Redirect target hidden by runtime (opaqueredirect): ${currentUrl}`,
      );
    }
    const location = res.headers?.get?.("location");
    if (
      typeof res.status === "number" &&
      res.status >= 300 &&
      res.status < 400 &&
      location
    ) {
      try {
        await res.body?.cancel?.();
      } catch {}
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    return res;
  }
  throw new FetchLimitError(
    DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
    `Too many redirects (>${MAX_REDIRECTS}): ${target}`,
  );
}

/** Read a response body up to `maxBytes`, cancelling the stream immediately on overflow. */
export async function readResponseWithLimit(
  res: Response,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (maxBytes !== undefined) {
    const rawLength = res.headers?.get?.("content-length");
    const contentLength = rawLength !== null && rawLength !== undefined ? Number(rawLength) : NaN;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      try {
        await res.body?.cancel?.();
      } catch {}
      throw new FetchLimitError(
        DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE,
        `Resource size (${contentLength} bytes) exceeds limit (${maxBytes})`,
      );
    }
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      // Pre-allocate a single buffer when Content-Length is known to avoid 2x chunk-assembly peaks.
      let prealloc =
        Number.isFinite(contentLength) && contentLength > 0
          ? new Uint8Array(contentLength)
          : null;
      let chunks: Uint8Array[] | null = prealloc ? null : [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const nextSize = size + value.length;
        if (nextSize > maxBytes) {
          try {
            await reader.cancel();
          } catch {}
          throw new FetchLimitError(
            DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE,
            `Resource size (${nextSize} bytes) exceeds limit (${maxBytes})`,
          );
        }
        if (prealloc) {
          if (nextSize <= prealloc.length) {
            prealloc.set(value, size);
          } else {
            // Content-Length under-reported: spill into chunk list once.
            chunks = [prealloc.subarray(0, size), value];
            prealloc = null;
          }
        } else {
          chunks!.push(value);
        }
        size = nextSize;
      }
      if (prealloc) {
        return size === prealloc.length ? prealloc : prealloc.slice(0, size);
      }
      const out = new Uint8Array(size);
      let off = 0;
      for (const chunk of chunks!) {
        out.set(chunk, off);
        off += chunk.length;
      }
      return out;
    }
  }
  const bytes = toBytes(await res.arrayBuffer());
  if (maxBytes !== undefined && bytes.length > maxBytes) {
    throw new FetchLimitError(
      DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE,
      `Resource size (${bytes.length} bytes) exceeds limit (${maxBytes})`,
    );
  }
  return bytes;
}

/**
 * Fetch external resource bytes. `data:` URLs resolve inline in C++
 * (`request()`), so they are skipped here. Relative URLs resolve against
 * `baseUrl` (http base via fetch, fs path via node:fs on Node).
 */
export async function fetchResourceBytes(
  url: string,
  baseUrl?: string,
  userAgent?: string,
  resolveResource?: ResolveResourceHook,
  timeoutMs?: number,
  confineFiles?: boolean,
  limits?: RenderLimits,
  onLimitExceeded?: (code: string, message: string) => void,
  useCache = true,
): Promise<Uint8Array | null> {
  if (url.startsWith("data:")) return null;
  const fallback = (): Promise<Uint8Array | null> =>
    fetchResourceBytesInner(
      url,
      baseUrl,
      userAgent,
      timeoutMs,
      confineFiles,
      limits,
      onLimitExceeded,
      useCache,
    );
  if (resolveResource) {
    try {
      return await resolveResource(url, fallback);
    } catch {
      return null;
    }
  }
  return fallback();
}

/** True when `target` resolves (symlinks included) inside `root`. */
async function isInsideDir(
  fs: typeof import("node:fs/promises"),
  path: typeof import("node:path"),
  root: string,
  target: string,
): Promise<boolean> {
  try {
    const realRoot = await fs.realpath(path.resolve(root));
    const realTarget = await fs.realpath(path.resolve(target));
    const rel = path.relative(realRoot, realTarget);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Built-in resolution behind the `resolveResource` hook (see above). */
async function fetchResourceBytesInner(
  url: string,
  baseUrl?: string,
  userAgent?: string,
  timeoutMs?: number,
  confineFiles?: boolean,
  limits?: RenderLimits,
  onLimitExceeded?: (code: string, message: string) => void,
  useCache = true,
): Promise<Uint8Array | null> {
  // Browser fetch forbids overriding User-Agent (and Firefox preflights it,
  // breaking Google Fonts/jsDelivr CORS). Spoof only where we control the UA
  // (Node, Workers) to get woff2 CSS.
  const headers =
    userAgent && canSetUserAgent() ? { "User-Agent": userAgent } : undefined;
  // Abort hung connections so one stalled server cannot outlive `timeoutMs`.
  const signal =
    timeoutMs !== undefined
      ? // Node >= 24 requires an integer delay; the remaining budget is fractional.
        AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))
      : undefined;
  const fetchBytes = async (target: string): Promise<Uint8Array | null> => {
    // Servers may vary the body by User-Agent (e.g. woff2 vs ttf CSS).
    const cacheKey = `${userAgent ?? ""}
${target}`;
    const cached = useCache ? resourceCache.get(cacheKey) : undefined;
    if (cached) {
      if (
        limits?.maxResourceBytes !== undefined &&
        cached.length > limits.maxResourceBytes
      ) {
        onLimitExceeded?.(
          DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE,
          `Resource size (${cached.length} bytes) exceeds limit (${limits.maxResourceBytes})`,
        );
        return null;
      }
      return cached;
    }
    try {
      const res = await fetchWithLimits(
        target,
        {
          ...(headers ? { headers } : {}),
          ...(signal ? { signal } : {}),
        },
        limits,
      );
      if (!res.ok) {
        try {
          await res.body?.cancel?.();
        } catch {}
        return null;
      }
      const bytes = await readResponseWithLimit(res, limits?.maxResourceBytes);
      if (useCache) resourceCache.set(cacheKey, bytes);
      return bytes;
    } catch (e) {
      if (e instanceof FetchLimitError) {
        onLimitExceeded?.(e.code, e.message);
      }
      return null;
    }
  };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    return fetchBytes(url);
  }
  if (baseUrl !== undefined) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)) {
      try {
        return await fetchBytes(new URL(url, baseUrl).href);
      } catch {
        return null;
      }
    }
    if (isNodeRuntime()) {
      try {
        const fs =
          await importNode<typeof import("node:fs/promises")>("fs/promises");
        const path = await importNode<typeof import("node:path")>("path");
        const root = fileUrlToFsPath(baseUrl);
        const joined = path.join(root, url);
        if (confineFiles && !(await isInsideDir(fs, path, root, joined))) {
          return null;
        }
        const cached = useCache ? resourceCache.get(joined) : undefined;
        if (cached) return cached;
        // Keep an owning copy: fs Buffers may ride a shared pool.
        const bytes = new Uint8Array(await fs.readFile(joined));
        if (useCache) resourceCache.set(joined, bytes);
        return bytes;
      } catch {
        return null;
      }
    }
    return null;
  }
  // Without a baseUrl there is no directory to confine reads to.
  if (isNodeRuntime() && !confineFiles) {
    try {
      const cached = useCache ? resourceCache.get(url) : undefined;
      if (cached) return cached;
      const fs =
        await importNode<typeof import("node:fs/promises")>("fs/promises");
      // Keep an owning copy: fs Buffers may ride a shared pool.
      const bytes = new Uint8Array(await fs.readFile(url));
      if (useCache) resourceCache.set(url, bytes);
      return bytes;
    } catch {
      return null;
    }
  }
  return null;
}

export interface PendingResource {
  type: "font" | "image" | "css";
  url: string;
  name: string;
}

/** Parse the `get_pending_resources` binary form (see loader.ts). */
export function parsePendingResources(
  bin: Uint8Array | null | undefined,
): PendingResource[] {
  if (!bin || bin.length < 4) return [];
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const dec = new TextDecoder();
  let off = 0;
  const readStr = (): string | null => {
    if (off + 4 > bin.byteLength) return null;
    const len = view.getUint32(off, true);
    off += 4;
    if (off + len > bin.byteLength) return null;
    const s = dec.decode(new Uint8Array(bin.buffer, bin.byteOffset + off, len));
    off += len;
    return s;
  };
  const count = view.getUint32(off, true);
  off += 4;
  const out: PendingResource[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 2 > bin.byteLength) break;
    const typeInt = view.getUint8(off);
    off += 2; // type + redraw_on_ready
    const url = readStr();
    const name = readStr();
    if (readStr() === null || url === null || name === null) break;
    out.push({
      type: typeInt === 2 ? "image" : typeInt === 3 ? "css" : "font",
      url,
      name,
    });
  }
  return out;
}

/** Monotonic-ish clock for timings (satoru parity). */
export function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Mutable diagnostics collection state (internal, `diagnostics: true` only). */
export interface DiagState {
  resources: ResourceDiagnostic[];
  fonts: FontDiagnostic[];
  warnings: DiagnosticMessage[];
  errors: DiagnosticMessage[];
}

/** Resource usage counters enforced by `limits` (always tracked). */
export interface ResourceUsage {
  resourceCount: number;
  totalResourceBytes: number;
  /** Font files dropped because `maxResourceCount` was reached (across all rounds). */
  fontsSkippedByCount: number;
}

/** Resolution context threaded through HTML discovery (internal). */
export interface ResolveContext {
  mediaTypeInt: number;
  css?: string;
  fonts?: { name: string; data: Uint8Array }[];
  limits: RenderLimits;
  resolveResource?: ResolveResourceHook;
  resourceCache?: boolean;
  /**
   * Publish an image's fetch state to a live page (the QuickJS registry). `loading` goes out before the
   * fetch, then `loaded` once the bytes are in the engine, or `error`. The renderer is the only fetch:
   * the page learns the result from this hook instead of requesting the image a second time.
   */
  onImageResource?: (url: string, record: ImageResourceRecord) => void;
  diag: DiagState | null;
  usage: ResourceUsage;
  t0: number;
  emitLog: (level: LogLevel, message: string) => void;
  /** Accumulate a timing (no-op unless diagnostics are enabled). */
  addTime: (name: string, ms: number) => void;
  /** Throw a timeout error when `limits.timeoutMs` is exceeded. */
  checkTimeout: () => void;
}

/**
 * Protocol/host allow-list check. Returns a block reason, or `null` when
 * allowed. Relative URLs skip the check (satoru parity).
 */
export function checkResourceAllowed(
  url: string,
  limits: RenderLimits,
): string | null {
  if (
    !limits.allowedProtocols &&
    !limits.allowedHosts &&
    !limits.blockedHosts &&
    !limits.blockPrivateHosts
  ) {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    limits.allowedProtocols &&
    !limits.allowedProtocols.includes(parsed.protocol)
  ) {
    return `Protocol ${parsed.protocol} is blocked`;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (limits.allowedHosts && !limits.allowedHosts.includes(host)) {
    return `Host ${parsed.hostname} is not in allowed list`;
  }
  if (limits.blockedHosts && limits.blockedHosts.includes(host)) {
    return `Host ${parsed.hostname} is blocked`;
  }
  if (limits.blockPrivateHosts && isPrivateHost(host)) {
    return `Host ${parsed.hostname} is private`;
  }
  return null;
}

/** Limit-violation code for a block reason (satoru parity). */
export function limitCodeForReason(reason: string): string {
  if (reason.startsWith("Protocol "))
    return DIAGNOSTIC_CODES.LIMIT_PROTOCOL_BLOCKED;
  return DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED;
}

/**
 * Max resource fetches in flight at once. All pages of a document are discovered
 * together, so this bounds the connection burst for many-page documents.
 */
export const FETCH_CONCURRENCY = 16;

/** Max concurrent fetches per destination host (avoids bursting a single origin or hitting CF per-host limits). */
export const FETCH_CONCURRENCY_PER_HOST = 6;

/**
 * Resolve the relative `url(...)` and `@import` references of a fetched stylesheet against
 * the stylesheet's own URL. The engine resolves them against the page, which is wrong as soon
 * as the sheet lives in another directory (`url(../fonts/a.woff)` in `/static/css/a.css`).
 * Absolute, protocol-relative, `data:`, `#` and root-relative references are left alone, and a
 * root-relative sheet URL keeps its root-relative form.
 */
export function absolutizeCssUrls(css: string, cssUrl: string): string {
  if (!css.includes("url(") && !css.includes("@import")) return css;
  const dummy = "http://css-base.invalid/";
  let base: URL;
  try {
    base = new URL(cssUrl, dummy);
  } catch {
    return css;
  }
  const keepRootRelative = cssUrl.startsWith("/");
  const absoluteCssUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cssUrl);
  const resolve = (ref: string): string => {
    const t = ref.trim();
    if (
      t === "" ||
      t.startsWith("#") ||
      t.startsWith("/") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)
    )
      return ref;
    try {
      const u = new URL(t, base);
      if (absoluteCssUrl) return u.href;
      if (u.origin !== base.origin) return u.href;
      const path = u.pathname + u.search + u.hash;
      return keepRootRelative ? path : path.slice(1);
    } catch {
      return ref;
    }
  };
  return css
    .replace(
      /url\(\s*(['"]?)([^'")]*)\1\s*\)/g,
      (_m, q: string, ref: string) => `url(${q}${resolve(ref)}${q})`,
    )
    .replace(
      /@import\s+(['"])([^'"]+)\1/g,
      (_m, q: string, ref: string) => `@import ${q}${resolve(ref)}${q}`,
    );
}

/** Run `fn` over `items` with at most `limit` calls in flight (`fn` must not reject). */
export async function mapWithLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/**
 * Run `fn` over `items` with at most `globalLimit` calls in flight and at most
 * `perHostLimit` calls per host key (`fn` must not reject).
 */
export async function mapWithHostLimit<T>(
  items: readonly T[],
  globalLimit: number,
  perHostLimit: number,
  hostOf: (item: T) => string,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = items.map((item) => ({ item, host: hostOf(item) }));
  const hostInflight = new Map<string, number>();
  let globalInflight = 0;
  let completed = 0;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (completed === items.length) {
        resolve();
        return;
      }
      while (globalInflight < globalLimit && queue.length > 0) {
        const idx = queue.findIndex(
          (entry) => (hostInflight.get(entry.host) ?? 0) < perHostLimit,
        );
        if (idx === -1) break;
        const [entry] = queue.splice(idx, 1);
        globalInflight++;
        hostInflight.set(entry.host, (hostInflight.get(entry.host) ?? 0) + 1);
        void fn(entry.item).finally(() => {
          globalInflight--;
          const prev = hostInflight.get(entry.host) ?? 1;
          if (prev <= 1) hostInflight.delete(entry.host);
          else hostInflight.set(entry.host, prev - 1);
          completed++;
          pump();
        });
      }
    };
    pump();
  });
}

/** Remaining `timeoutMs` budget for one fetch (undefined = unlimited). */
function fetchTimeoutOf(ctx: ResolveContext): number | undefined {
  return ctx.limits.timeoutMs === undefined
    ? undefined
    : ctx.limits.timeoutMs - (now() - ctx.t0);
}

export type FallbackFontSource = Uint8Array | ArrayBuffer | string;

export type FallbackFontUnicodePreset =
  | "cjk"
  | "emoji"
  | "symbols"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "thai";

export type FallbackFontEntry =
  | FallbackFontSource
  | {
      source: FallbackFontSource;
      /** Load this fallback font only when the HTML contains characters matching this preset or RegExp. */
      unicodeRange?: RegExp | FallbackFontUnicodePreset;
    };

const UNICODE_PRESETS: Record<FallbackFontUnicodePreset, RegExp> = {
  cjk: /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/,
  emoji:
    /[\u{1F000}-\u{1FFFF}\u231A-\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\uFE0F]/u,
  symbols: /[\u{2100}-\u{2BFF}]/u,
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
  hebrew: /[\u0590-\u05FF\uFB1D-\uFB4F]/,
  devanagari: /[\u0900-\u097F\uA8E0-\uA8FF]/,
  thai: /[\u0E00-\u0E7F]/,
};

function decodeNumericEntitiesForScan(html: string): string {
  if (!html.includes("&#")) return html;
  let decoded = "";
  for (const match of html.matchAll(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi)) {
    const cp = Number.parseInt(match[1] ?? match[2], match[1] ? 16 : 10);
    if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
      decoded += String.fromCodePoint(cp);
    }
  }
  return decoded ? html + decoded : html;
}

/** True when any page in `htmls` contains a character matching `range`. */
export function htmlMatchesUnicodeRange(
  htmls: string | string[],
  range: RegExp | FallbackFontUnicodePreset,
): boolean {
  const re =
    typeof range === "string"
      ? UNICODE_PRESETS[range]
      : range.global || range.sticky
        ? new RegExp(range.source, range.flags.replace(/[gy]/g, ""))
        : range;
  const pages = Array.isArray(htmls) ? htmls : [htmls];
  return pages.some((page) => re.test(decodeNumericEntitiesForScan(page)));
}

/**
 * Upstream-style discovery loop: collect pending URLs on the satoru
 * instance, fetch them (file/http), and inject the bytes back, so the
 * subsequent render on the SAME instance sees cached fonts/images.
 * Missing bindings (old builds) skip the loop silently.
 */
export async function resolveHtmlResources(
  module: HtmlToImageModule,
  satoruInst: unknown,
  htmls: string | string[],
  width: number,
  height: number | undefined,
  baseUrl: string | undefined,
  fontMap: Record<string, string> | undefined,
  userAgent: string | undefined,
  fallbackFonts: FallbackFontEntry[] | undefined,
  ctx: ResolveContext,
): Promise<void> {
  const collect = module.satoru_collect_resources;
  const getPending = module.satoru_get_pending_resources;
  const addRes = module.satoru_add_resource;
  if (
    typeof collect !== "function" ||
    typeof getPending !== "function" ||
    typeof addRes !== "function"
  )
    return;
  // Upstream default: generic families resolve via fontMap before discovery.
  if (fontMap) {
    const setFontMap = module.satoru_set_font_map;
    if (typeof setFontMap === "function") {
      (await setFontMap(satoruInst, { ...fontMap })) as unknown;
      ctx.emitLog(LogLevel.Debug, "fontMap applied");
    }
  }
  // Upstream idiom: user-supplied fallback fonts go in before discovery.
  if (fallbackFonts && fallbackFonts.length > 0) {
    const loadFallback = module.satoru_load_fallback_font;
    if (typeof loadFallback === "function") {
      for (const rawEntry of fallbackFonts) {
        const isConfig =
          typeof rawEntry === "object" &&
          rawEntry !== null &&
          !(rawEntry instanceof Uint8Array) &&
          !(rawEntry instanceof ArrayBuffer);
        if (
          isConfig &&
          rawEntry.unicodeRange !== undefined &&
          !htmlMatchesUnicodeRange(htmls, rawEntry.unicodeRange)
        ) {
          continue;
        }
        const entry = isConfig ? rawEntry.source : rawEntry;
        try {
          const bytes =
            typeof entry === "string"
              ? entry.startsWith("data:")
                ? dataUrlToBytes(entry)
                : await fetchResourceBytes(
                    entry,
                    baseUrl,
                    userAgent,
                    ctx.resolveResource,
                    fetchTimeoutOf(ctx),
                    ctx.limits.confineFilesToBaseUrl,
                    ctx.limits,
                    undefined,
                    ctx.resourceCache !== false,
                  )
              : entry instanceof Uint8Array
                ? entry
                : new Uint8Array(entry);
          if (!bytes || bytes.length === 0) continue;
          (await loadFallback(satoruInst, bytes)) as unknown;
          ctx.diag?.fonts.push({
            family: "(fallback)",
            status: "loaded",
            source: typeof entry === "string" ? entry : "(bytes)",
          });
        } catch {
          // Per-font failure is non-fatal; discovery proceeds regardless.
          ctx.diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message: "Failed to load fallback font entry",
          });
        }
      }
    }
  }
  // Named font preloads (`fonts` option), before discovery (satoru parity).
  if (ctx.fonts && ctx.fonts.length > 0) {
    const loadFont = module.satoru_load_font;
    if (typeof loadFont === "function") {
      for (const f of ctx.fonts) {
        try {
          (await loadFont(satoruInst, f.name, f.data)) as unknown;
          ctx.diag?.fonts.push({
            family: f.name,
            status: "loaded",
            source: "fonts option",
          });
        } catch (e) {
          ctx.diag?.warnings.push(
            errorToDiagnostic(
              e,
              DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
              f.name,
            ),
          );
        }
      }
    }
  }
  // Extra CSS pre-scan (`css` option), before discovery (satoru parity).
  if (ctx.css) {
    const scanCss = module.satoru_scan_css;
    if (typeof scanCss === "function") {
      try {
        (await scanCss(satoruInst, ctx.css)) as unknown;
        ctx.emitLog(LogLevel.Debug, "css pre-scanned");
      } catch (e) {
        ctx.diag?.warnings.push(
          errorToDiagnostic(
            e,
            DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            "(css option)",
          ),
        );
      }
    }
  }
  // Collect-phase profiling (merged into timings when diagnostics on).
  const setProfile = module.satoru_set_collect_profile_enabled;
  const profileEnabled = ctx.diag !== null && typeof setProfile === "function";
  if (profileEnabled) {
    try {
      (await setProfile(satoruInst, true)) as unknown;
    } catch {
      // Non-fatal; timings simply miss the C++ breakdown.
    }
  }
  // The page and the render share one fetch per image: the renderer fetches here and publishes the
  // transition to a live QuickJS page (`onImageResource` -> `QuickJSDOM.setImageResource`), which fires
  // that page's load/error event and settles decode(). The page never fetches image bytes itself, so this
  // request is not repeated there. `imageStates` is the last state published per URL: an image the engine
  // asks for again in a later round does not fire the same event twice.
  // TODO(size): the decoded width/height are not available from the engine yet (no binding exposes them),
  // so a loaded record leaves naturalWidth/naturalHeight at 0. Add them here once the engine reports them;
  // the timing (this hook) is what the bridge shares today.
  const imageStates = new Map<string, ImageResourceRecord["status"]>();
  const publishImage = (url: string, status: ImageResourceRecord["status"]): void => {
    const publish = ctx.onImageResource;
    if (!publish || imageStates.get(url) === status) return;
    imageStates.set(url, status);
    try {
      publish(url, { status });
    } catch {
      // A listener's failure must not fail the render.
    }
  };
  for (let round = 0; round < 10; round++) {
    ctx.checkTimeout();
    // One wasm call covers every page: the C++ side lays each page out in turn and
    // accumulates its requests, so a single read returns the union for all pages and
    // their fetches run in parallel (previously: collect, fetch, repeat per page).
    (await collect(
      satoruInst,
      htmls,
      width,
      height ?? 0,
      ctx.mediaTypeInt,
    )) as unknown;
    const bin = (await getPending(satoruInst)) as Uint8Array | null | undefined;
    const pending = parsePendingResources(
      bin instanceof Uint8Array ? bin : undefined,
    );
    if (pending.length === 0) break;
    // Stylesheets cascade by document order, not by fetch completion order: a small
    // later sheet must not land before (and so lose to) a large earlier one. They are
    // buffered here and injected in discovery order once the whole round has settled.
    const loadedCss: { index: number; url: string; bytes: Uint8Array }[] = [];
    // When maxResourceCount cuts a round short, what is dropped should be the least harmful: a missing
    // image leaves a hole, a missing font turns the whole text into tofu. Stylesheets go first (they
    // cascade by document order and may reveal more), then fonts, then images; discovery order is
    // kept within each kind.
    const rank = (t: string): number => (t === "css" ? 0 : t === "font" ? 1 : 2);
    const ordered = pending
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r.type) - rank(b.r.type) || a.i - b.i)
      .map((e) => e.r);
    const hostKeyOf = (r: PendingResource): string => {
      try {
        return new URL(r.url, baseUrl).host || "\u2205";
      } catch {
        return "\u2205";
      }
    };
    await mapWithHostLimit(
      ordered,
      FETCH_CONCURRENCY,
      FETCH_CONCURRENCY_PER_HOST,
      hostKeyOf,
      async (r) => {
      const diag = ctx.diag;
      const entry: ResourceDiagnostic | undefined = diag
        ? {
            type: r.type,
            url: r.url,
            name: r.name || undefined,
            status: "pending",
          }
        : undefined;
      if (diag && entry) diag.resources.push(entry);
      const settle = (
        status: ResourceDiagnostic["status"],
        bytes?: number,
        reason?: string,
      ): void => {
        if (!entry) return;
        entry.status = status;
        if (bytes !== undefined) entry.bytes = bytes;
        if (reason !== undefined) entry.reason = reason;
      };
      const skipWithError = (code: string, message: string): void => {
        settle("skipped", undefined, message);
        diag?.errors.push({ code, message, source: r.url });
        ctx.emitLog(LogLevel.Warning, `${message} (${r.url})`);
      };
      try {
        if (r.url.startsWith("data:")) {
          // Inline data: URLs resolve inside C++; nothing to fetch.
          settle("skipped", undefined, "inline data URL (resolved in C++)");
          return;
        }
        const blocked = checkResourceAllowed(r.url, ctx.limits);
        if (blocked) {
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(limitCodeForReason(blocked), blocked);
          return;
        }
        // Reserve the slot before awaiting so parallel fetches cannot
        // all pass the count check; released again if the fetch fails.
        if (
          ctx.limits.maxResourceCount !== undefined &&
          ctx.usage.resourceCount >= ctx.limits.maxResourceCount
        ) {
          const message = `Maximum resource count (${ctx.limits.maxResourceCount}) exceeded`;
          if (r.type === "font") ctx.usage.fontsSkippedByCount++;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT, message);
          return;
        }
        ctx.usage.resourceCount++;
        if (r.type === "image") publishImage(r.url, "loading");
        let limitHit: { code: string; message: string } | null = null;
        const bytes = await fetchResourceBytes(
          r.url,
          baseUrl,
          userAgent,
          ctx.resolveResource,
          fetchTimeoutOf(ctx),
          ctx.limits.confineFilesToBaseUrl,
          ctx.limits,
          (code, message) => {
            limitHit = { code, message };
          },
          ctx.resourceCache !== false,
        );
        if (limitHit) {
          const hit = limitHit as { code: string; message: string };
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(hit.code, hit.message);
          return;
        }
        if (!bytes) {
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          settle("failed");
          const message = `Failed to fetch resource: ${r.url}`;
          diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message,
            source: r.url,
          });
          ctx.emitLog(LogLevel.Warning, message);
          return;
        }
        if (
          ctx.limits.maxResourceBytes !== undefined &&
          bytes.length > ctx.limits.maxResourceBytes
        ) {
          const message =
            `Resource size (${bytes.length} bytes) exceeds limit ` +
            `(${ctx.limits.maxResourceBytes})`;
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE, message);
          return;
        }
        // Check-and-add without an intervening await keeps this atomic.
        if (
          ctx.limits.maxTotalResourceBytes !== undefined &&
          ctx.usage.totalResourceBytes + bytes.length >
            ctx.limits.maxTotalResourceBytes
        ) {
          const message = `Total resource size exceeds limit (${ctx.limits.maxTotalResourceBytes})`;
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_TOTAL_SIZE, message);
          return;
        }
        ctx.usage.totalResourceBytes += bytes.length;
        settle("loaded", bytes.length);
        if (r.type === "css") {
          loadedCss.push({ index: pending.indexOf(r), url: r.url, bytes });
          return;
        }
        (await addRes(
          satoruInst,
          r.url,
          r.type === "image" ? 2 : 1,
          bytes,
        )) as unknown;
        // The engine now owns the bytes: the page's image is "loaded" from this real transition, not a
        // synthetic one. No second fetch happens in the page.
        if (r.type === "image") publishImage(r.url, "loaded");
        if (r.type === "font") {
          diag?.fonts.push({
            family: r.name || r.url,
            status: "loaded",
            source: r.url,
          });
        }
      } catch (e) {
        // Per-resource failure is non-fatal; render proceeds regardless.
        if (r.type === "image") publishImage(r.url, "error");
        const d = errorToDiagnostic(
          e,
          DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
          r.url,
        );
        settle("failed", undefined, d.message);
        diag?.warnings.push(d);
      }
    });
    loadedCss.sort((a, b) => a.index - b.index);
    for (const css of loadedCss) {
      const text = new TextDecoder().decode(css.bytes);
      const fixed = absolutizeCssUrls(text, css.url);
      const bytes = fixed === text ? css.bytes : new TextEncoder().encode(fixed);
      (await addRes(satoruInst, css.url, 3, bytes)) as unknown;
    }
  }
  if (ctx.usage.fontsSkippedByCount > 0) {
    // Text in those fonts renders as tofu: say what to change instead of leaving a silent bad image.
    // One message for the whole render, however many discovery rounds hit the limit.
    const message =
      `${ctx.usage.fontsSkippedByCount} font file(s) were not loaded because maxResourceCount ` +
      `(${ctx.limits.maxResourceCount}) was reached; text using them may render as missing glyphs. ` +
      "Raise limits.maxResourceCount (a Google Fonts stylesheet alone can reference over a hundred files).";
    ctx.diag?.warnings.push({
      code: DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT,
      message,
    });
    ctx.emitLog(LogLevel.Warning, message);
    if (ctx.limits.strictFonts) {
      throw new Error(`[${DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT}] ${message}`);
    }
  }
  // Merge the C++ collect-phase breakdown into the JS timings.
  if (profileEnabled && ctx.diag) {
    const getProfile = module.satoru_get_collect_profile;
    if (typeof getProfile === "function") {
      try {
        const parsed = JSON.parse(
          (await getProfile(satoruInst)) as string,
        ) as Record<string, number>;
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "number") {
            ctx.addTime(key, value);
          }
        }
      } catch {
        // Non-fatal; timings simply miss the C++ breakdown.
      }
    }
  }
}
