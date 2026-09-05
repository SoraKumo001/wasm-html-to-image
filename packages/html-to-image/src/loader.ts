/**
 * Single-WASM loader for the unified `html-to-image` Emscripten module.
 *
 * Build assumptions (see `src/cpp/main.cpp`, C++ lane owns them):
 * - Emscripten `MODULARIZE` + `EXPORT_ES6` → `dist/html-to-image.js`
 *   with `export default createHtmlToImageModule`.
 * - Single `EMSCRIPTEN_BINDINGS(html_to_image)` with `satoru_*` /
 *   `converter_*` prefixed JS names (no bare `create_instance` etc.).
 *
 * Currently registered (Phase 1): instance lifecycle + log level only
 * (`satoru_create_instance` / `satoru_destroy_instance` /
 * `satoru_set_log_level` / `converter_create_instance` /
 * `converter_destroy_instance` / `converter_set_log_level`).
 * Per-value `satoru_render` / `converter_encode` wrappers and the unified
 * Bitmap-direct `html_to_image` binding land in Phase 2 (C++ lane) and are
 * therefore typed as optional here; callers must feature-check at runtime
 * (see `./core.ts`).
 *
 * Node and browser share this minimal shape: dynamic `import()` of the glue
 * file URL, then invoking the factory. No `node:` builtins are used so the
 * same file works in both runtimes.
 */

/** Opaque WASM instance handle (Embind `allow_raw_pointers` raw pointer). */
export type WasmInstancePtr = unknown;

/** Extra Emscripten `Module` arguments passed to the factory. */
export interface EmscriptenModuleArg extends Record<string, unknown> {
  locateFile?: (path: string, scriptDirectory: string) => string;
}

/**
 * Structural view of the instantiated unified module.
 * Required members are the Phase-1-registered bindings; optional members
 * are the Phase-2 bindings (probed with `typeof` before use).
 */
export interface HtmlToImageModule {
  satoru_create_instance(): WasmInstancePtr;
  satoru_destroy_instance(inst: WasmInstancePtr): void;
  satoru_set_log_level(level: number): void;
  converter_create_instance(): WasmInstancePtr;
  converter_destroy_instance(inst: WasmInstancePtr): void;
  converter_set_log_level(level: number): void;
  /** Phase 2: HTML render wrapper (single plain-options object in/out). */
  satoru_render?: (...args: unknown[]) => unknown;
  /** Phase 2: image encode wrapper (single plain-options object in/out). */
  converter_encode?: (...args: unknown[]) => unknown;
  /**
   * Phase 2 (planned): unified Bitmap-direct call
   * (`render_bitmap_to_encoded` exposed to JS, no PNG intermediate
   * round-trip through JS). Provisional name — the C++ lane owns it.
   */
  html_to_image?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/** `MODULARIZE` factory shape (`export default createHtmlToImageModule`). */
export type CreateHtmlToImageModule = (
  moduleArg?: EmscriptenModuleArg,
) => Promise<HtmlToImageModule>;

export interface LoadOptions {
  /**
   * Explicit glue file URL/path (`dist/html-to-image.js`).
   * Default: `./html-to-image.js` next to the compiled loader.
   */
  glueUrl?: string | URL;
  /** Emscripten `locateFile` override (`.wasm` resolution). */
  locateFile?: (path: string, scriptDirectory: string) => string;
  /** Extra Emscripten `Module` arguments. */
  moduleArg?: EmscriptenModuleArg;
  /**
   * Pre-bundled MODULARIZE factory (workerd: statically imported glue).
   * When set, the dynamic `import()` of the glue file is skipped.
   * Non-breaking addition; existing callers are unaffected.
   */
  factory?: CreateHtmlToImageModule;
  /** Bypass the process-wide cache (tests). */
  noCache?: boolean;
}

let cachedModule: HtmlToImageModule | null = null;

/** Default glue URL: `./html-to-image.js` next to the compiled loader. */
export function defaultGlueUrl(): URL {
  return new URL("./html-to-image.js", import.meta.url);
}

/**
 * Load and instantiate the unified module (cached per process).
 * Works in Node (file URL import) and browsers (served URL import).
 */
export async function loadHtmlToImageModule(
  options: LoadOptions = {},
): Promise<HtmlToImageModule> {
  if (cachedModule && !options.noCache) return cachedModule;
  let factory = options.factory;
  let glueLabel = "(pre-bundled factory)";
  let glueDir = "";
  if (!factory) {
    const glue = String(options.glueUrl ?? defaultGlueUrl());
    glueLabel = glue;
    glueDir = glue.slice(0, glue.lastIndexOf("/") + 1);
    const ns = (await import(/* @vite-ignore */ glue)) as {
      default?: CreateHtmlToImageModule;
      createHtmlToImageModule?: CreateHtmlToImageModule;
    };
    factory = ns.default ?? ns.createHtmlToImageModule;
  }
  if (typeof factory !== "function") {
    throw new Error(
      `wasm-html-to-image: no MODULARIZE factory in ${glueLabel} ` +
        `(expected default export createHtmlToImageModule)`,
    );
  }
  const module = await factory({
    ...options.moduleArg,
    locateFile:
      options.locateFile ??
      options.moduleArg?.locateFile ??
      ((path: string) => glueDir + path),
  });
  if (!options.noCache) cachedModule = module;
  return module;
}

/** Drop the cached instance (tests / HMR). */
export function dropCachedModule(): void {
  cachedModule = null;
}
