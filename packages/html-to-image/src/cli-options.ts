/**
 * CLI flag plumbing split from `./cli.ts` (behavior unchanged): input-type
 * detection, local file reading, and the flag -> `render()` option mapping.
 * Kept separate from the executable entry point so the mapping is
 * unit-testable without running the CLI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isImageInput } from "./input.js";
import type { HtmlToImageOptions, OutputFormat } from "./core.js";

/** Flags as parsed by commander (see `./cli.ts`). */
export interface CliFlags {
  output?: string;
  width: number;
  height?: number;
  format: OutputFormat;
  quality: number;
  /** Explicit `--base-url`; absent means "let the source decide". */
  baseUrl?: string;
}

/**
 * URL inputs are fetched, not read from disk. `data:` URLs stay values so
 * image inputs keep flowing through the converter pipeline.
 */
export function isUrlInput(input: string): boolean {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(input);
  return (
    !isWindowsPath &&
    /^[a-z][a-z0-9+.-]*:/i.test(input) &&
    !input.startsWith("data:")
  );
}

/**
 * Read a local input file as binary; image files (magic-byte sniffed) are
 * passed through as bytes, everything else as UTF-8 text (HTML).
 */
export async function readInput(
  input: string,
): Promise<{ value: string | Uint8Array; baseUrl: string }> {
  const data = await fs.readFile(input);
  let value: string | Uint8Array = data.toString("utf-8");
  try {
    if (isImageInput(data)) value = data;
  } catch {
    // Unknown binary magic -> treat as text and let rendering decide.
  }
  return { value, baseUrl: path.dirname(path.resolve(input)) };
}

/**
 * Map CLI flags to `render()` options.
 *
 * `--base-url` is the only way to pin the base: without it a URL input leaves
 * `baseUrl` unset so relative resources follow the post-redirect final URL
 * (`resolveHtmlSource`), while a file input falls back to its own directory.
 */
export async function buildRenderOptions(
  input: string,
  flags: CliFlags,
): Promise<HtmlToImageOptions> {
  const source = isUrlInput(input)
    ? { url: input }
    : await readInput(input);
  return {
    width: flags.width,
    height: flags.height,
    format: flags.format,
    quality: flags.quality,
    ...source,
    ...(flags.baseUrl !== undefined ? { baseUrl: flags.baseUrl } : {}),
  };
}
