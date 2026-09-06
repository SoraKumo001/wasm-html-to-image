/**
 * Playground-parity diagnostics (satoru-compatible shapes).
 *
 * `LogLevel` mirrors `satoru/log-level.ts` verbatim (numeric levels shared
 * with the WASM `set_log_level` binding). `RenderDiagnostics` mirrors
 * satoru's `RenderDiagnostics` so playground-style consumers can switch
 * imports without reshaping reports.
 */

/** Log severity, shared with the WASM `set_log_level` binding. */
export enum LogLevel {
  None = 0,
  Error = 1,
  Warning = 2,
  Info = 3,
  Debug = 4,
}

/** Status of a single discovered resource. */
export interface ResourceDiagnostic {
  type: "font" | "css" | "image";
  url: string;
  name?: string;
  status: "pending" | "loaded" | "failed" | "skipped";
  bytes?: number;
  reason?: string;
}

/**
 * Font record (best effort, JS-side only).
 * NOTE: per-glyph C++ diagnostics (`get_font_diagnostics`) have no binding
 * in this build (see `src/cpp/main.cpp`), so entries describe fonts this
 * layer loaded (option preloads, fetched font resources) rather than the
 * renderer's matched faces.
 */
export interface FontDiagnostic {
  family: string;
  weight?: number;
  style?: "normal" | "italic" | "oblique";
  status: "loaded" | "fallback" | "missing";
  source?: string;
  characters?: string;
}

/** A warning/error entry in the diagnostics report. */
export interface DiagnosticMessage {
  code: string;
  message: string;
  source?: string;
}

/** Full render diagnostics report (satoru-compatible). */
export interface RenderDiagnostics {
  version: 1;
  format: "svg" | "png" | "webp" | "pdf";
  width: number;
  height?: number;
  mediaType: "screen" | "print";
  timings: Record<string, number>;
  resources: ResourceDiagnostic[];
  fonts: FontDiagnostic[];
  warnings: DiagnosticMessage[];
  errors: DiagnosticMessage[];
}

/** Machine-readable diagnostic codes (satoru parity). */
export const DIAGNOSTIC_CODES = {
  LIMIT_TIMEOUT: "LIMIT_TIMEOUT",
  LIMIT_RESOURCE_SIZE: "LIMIT_RESOURCE_SIZE",
  LIMIT_TOTAL_SIZE: "LIMIT_TOTAL_SIZE",
  LIMIT_RESOURCE_COUNT: "LIMIT_RESOURCE_COUNT",
  LIMIT_PROTOCOL_BLOCKED: "LIMIT_PROTOCOL_BLOCKED",
  LIMIT_HOST_BLOCKED: "LIMIT_HOST_BLOCKED",
  /** Extension: a resource fetch (or resolveResource hook) failed. */
  RESOURCE_FETCH_FAILED: "RESOURCE_FETCH_FAILED",
} as const;

/** Safety/performance limits, enforced in JS around resource resolution. */
export interface RenderLimits {
  /** Timeout for the whole render in milliseconds. */
  timeoutMs?: number;
  /** Maximum bytes for a single resource. */
  maxResourceBytes?: number;
  /** Maximum total bytes for all resources. */
  maxTotalResourceBytes?: number;
  /** Maximum number of resources to load. */
  maxResourceCount?: number;
  /** Allowed URL protocols (e.g. `["http:", "https:"]`). */
  allowedProtocols?: string[];
  /** Allowed hostnames. */
  allowedHosts?: string[];
  /** Blocked hostnames. */
  blockedHosts?: string[];
}

/**
 * Override hook for resource resolution. Receives the absolute (or
 * baseUrl-relative) URL and a fallback that runs the built-in resolution;
 * return bytes to inject, or `null` to skip the resource.
 */
export type ResolveResourceHook = (
  url: string,
  fallback: () => Promise<Uint8Array | null>,
) => Promise<Uint8Array | null>;
