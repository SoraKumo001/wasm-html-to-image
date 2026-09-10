/**
 * Resource layer split from `./core.ts` (behavior unchanged).
 *
 * Owns: fetched-bytes cache, `fetchResourceBytes`, pending-resources
 * parsing, allow-list checks, and the `resolveHtmlResources` discovery loop.
 * Orchestration context types (`DiagState`, `ResolveContext`) live here so
 * both the loop and the orchestration/pipeline layer share them.
 */
import { importNode, type HtmlToImageModule } from "./loader.js";
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

/** Process-wide fetched-bytes cache (upstream `resourceCache` parity). */
const resourceCache = new Map<string, Uint8Array>();

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

function fileUrlToFsPath(p: string): string {
  if (!p.startsWith("file://")) return p;
  let out = decodeURIComponent(p.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(out)) out = out.slice(1);
  return out;
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
): Promise<Uint8Array | null> {
  if (url.startsWith("data:")) return null;
  const fallback = (): Promise<Uint8Array | null> =>
    fetchResourceBytesInner(url, baseUrl, userAgent);
  if (resolveResource) {
    try {
      return await resolveResource(url, fallback);
    } catch {
      return null;
    }
  }
  return fallback();
}

/** Built-in resolution behind the `resolveResource` hook (see above). */
async function fetchResourceBytesInner(
  url: string,
  baseUrl?: string,
  userAgent?: string,
): Promise<Uint8Array | null> {
  const headers = userAgent ? { "User-Agent": userAgent } : undefined;
  const fetchBytes = async (target: string): Promise<Uint8Array | null> => {
    const cached = resourceCache.get(target);
    if (cached) return cached;
    try {
      const res = await fetch(target, headers ? { headers } : undefined);
      if (!res.ok) return null;
      const bytes = toBytes(await res.arrayBuffer());
      resourceCache.set(target, bytes);
      return bytes;
    } catch {
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
        const joined = path.join(fileUrlToFsPath(baseUrl), url);
        const cached = resourceCache.get(joined);
        if (cached) return cached;
        // Keep an owning copy: fs Buffers may ride a shared pool.
        const bytes = new Uint8Array(await fs.readFile(joined));
        resourceCache.set(joined, bytes);
        return bytes;
      } catch {
        return null;
      }
    }
    return null;
  }
  if (isNodeRuntime()) {
    try {
      const cached = resourceCache.get(url);
      if (cached) return cached;
      const fs =
        await importNode<typeof import("node:fs/promises")>("fs/promises");
      // Keep an owning copy: fs Buffers may ride a shared pool.
      const bytes = new Uint8Array(await fs.readFile(url));
      resourceCache.set(url, bytes);
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
  totalResourceBytes: number;
  resourceCount: number;
}

/** Resolution context threaded through HTML discovery (internal). */
export interface ResolveContext {
  mediaTypeInt: number;
  css?: string;
  fonts?: { name: string; data: Uint8Array }[];
  limits: RenderLimits;
  resolveResource?: ResolveResourceHook;
  diag: DiagState | null;
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
    !limits.blockedHosts
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
  if (limits.allowedHosts && !limits.allowedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is not in allowed list`;
  }
  if (limits.blockedHosts && limits.blockedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is blocked`;
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
  fallbackFonts: (Uint8Array | ArrayBuffer | string)[] | undefined,
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
      for (const entry of fallbackFonts) {
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
  const list = Array.isArray(htmls) ? htmls : [htmls];
  for (let round = 0; round < 10; round++) {
    ctx.checkTimeout();
    let progressed = false;
    for (const html of list) {
      (await collect(
        satoruInst,
        html,
        width,
        height ?? 0,
        ctx.mediaTypeInt,
      )) as unknown;
      const bin = (await getPending(satoruInst)) as
        | Uint8Array
        | null
        | undefined;
      const pending = parsePendingResources(
        bin instanceof Uint8Array ? bin : undefined,
      );
      if (pending.length === 0) continue;
      progressed = true;
      await Promise.all(
        pending.map(async (r) => {
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
            if (
              ctx.limits.maxResourceCount !== undefined &&
              diag &&
              diag.resourceCount >= ctx.limits.maxResourceCount
            ) {
              const message = `Maximum resource count (${ctx.limits.maxResourceCount}) exceeded`;
              skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT, message);
              return;
            }
            const blocked = checkResourceAllowed(r.url, ctx.limits);
            if (blocked) {
              skipWithError(limitCodeForReason(blocked), blocked);
              return;
            }
            const bytes = await fetchResourceBytes(
              r.url,
              baseUrl,
              userAgent,
              ctx.resolveResource,
            );
            if (!bytes) {
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
              skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE, message);
              return;
            }
            if (
              ctx.limits.maxTotalResourceBytes !== undefined &&
              diag &&
              diag.totalResourceBytes + bytes.length >
                ctx.limits.maxTotalResourceBytes
            ) {
              const message = `Total resource size exceeds limit (${ctx.limits.maxTotalResourceBytes})`;
              skipWithError(DIAGNOSTIC_CODES.LIMIT_TOTAL_SIZE, message);
              return;
            }
            if (diag) {
              diag.resourceCount++;
              diag.totalResourceBytes += bytes.length;
            }
            settle("loaded", bytes.length);
            (await addRes(
              satoruInst,
              r.url,
              r.type === "image" ? 2 : r.type === "css" ? 3 : 1,
              bytes,
            )) as unknown;
            if (r.type === "font") {
              diag?.fonts.push({
                family: r.name || r.url,
                status: "loaded",
                source: r.url,
              });
            }
          } catch (e) {
            // Per-resource failure is non-fatal; render proceeds regardless.
            const d = errorToDiagnostic(
              e,
              DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
              r.url,
            );
            settle("failed", undefined, d.message);
            diag?.warnings.push(d);
          }
        }),
      );
    }
    if (!progressed) break;
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
