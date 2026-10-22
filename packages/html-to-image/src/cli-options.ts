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
  /** `--color-space <srgb|cmyk>`; absent means the default (srgb). */
  colorSpace?: "srgb" | "cmyk";
  /** `--scale <n>`; absent means 1. */
  scale?: number;
  /** `--dpi <n>`; absent means 96 x scale. */
  dpi?: number;
  /** `--animation <duration-ms>`; absent means "no keyframe animation". */
  animation?: number;
  /** `--animation-fps <n>`; defaults to 15 when `--animation` is set. */
  animationFps?: number;
  /**
   * `--animation-loop <n>`; how many times the animated WebP repeats.
   * Absent means infinite (libwebp loop_count 0 = the historical default).
   */
  animationLoop?: number;
}

/** Default frame rate for `--animation` when `--animation-fps` is omitted. */
export const DEFAULT_ANIMATION_FPS = 15;

/**
 * Animation flags resolved against the output format.
 *
 * Animated WebP is the only animated output the pipeline supports, so
 * `--animation` is ignored (with a warning) for every other format. The
 * boolean `animation: true` image-input path is intentionally not reachable
 * from the CLI: there the object form requests `@keyframes` sampling, which
 * is what `--animation` means.
 */
export interface AnimationResolution {
  /** Resolved `render()` animation option, or absent when disabled/ignored. */
  animation?: { duration: number; fps: number; loop?: number };
  /** Human-readable reason the flag was dropped; callers warn on stderr. */
  warning?: string;
}

/** Map `--animation` / `--animation-fps` / `--animation-loop` to the `render()` animation option. */
export function resolveAnimation(flags: CliFlags): AnimationResolution {
  if (flags.animation === undefined) {
    if (flags.animationFps !== undefined) {
      return { warning: "--animation-fps requires --animation; ignoring." };
    }
    if (flags.animationLoop !== undefined) {
      return { warning: "--animation-loop requires --animation; ignoring." };
    }
    return {};
  }
  if (flags.format !== "webp" && flags.format !== "apng" && flags.format !== "gif") {
    return {
      warning: `--animation is only supported for webp, apng and gif output; ignoring (format=${flags.format}).`,
    };
  }
  // `loop` stays absent unless requested: the render() default (0) is the
  // historical infinite loop, so the option object keeps its old shape.
  const loop =
    flags.animationLoop === undefined
      ? undefined
      : Math.max(0, Math.trunc(flags.animationLoop));
  return {
    animation: {
      duration: flags.animation,
      fps: flags.animationFps ?? DEFAULT_ANIMATION_FPS,
      ...(loop === undefined ? {} : { loop }),
    },
  };
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
  const { animation, warning } = resolveAnimation(flags);
  if (warning) console.warn(`wasm-html-to-image: ${warning}`);
  return {
    width: flags.width,
    height: flags.height,
    format: flags.format,
    quality: flags.quality,
    ...source,
    ...(flags.baseUrl !== undefined ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.colorSpace !== undefined ? { colorSpace: flags.colorSpace } : {}),
    ...(flags.scale !== undefined ? { scale: flags.scale } : {}),
    ...(flags.dpi !== undefined ? { dpi: flags.dpi } : {}),
    ...(animation ? { animation } : {}),
  };
}
