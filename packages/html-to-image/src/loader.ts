/**
 * Single-WASM loader for the unified `html-to-image` Emscripten module.
 *
 * Build assumptions (see `src/cpp/main.cpp`, C++ lane owns them):
 * - Emscripten `MODULARIZE` + `EXPORT_ES6` → `dist/html-to-image.js`
 *   with `export default createHtmlToImageModule`.
 * - Single `EMSCRIPTEN_BINDINGS(html_to_image)` with `satoru_*` /
 *   `converter_*` prefixed JS names (no bare `create_instance` etc.).
 *
 * Registered bindings: instance lifecycle + log level, render/encode
 * (`satoru_render`, `converter_encode`, ...), resource discovery/injection
 * (`satoru_collect_resources`, `satoru_get_pending_resources`,
 * `satoru_add_resource`, `satoru_load_font`, `satoru_load_fallback_font`,
 * `satoru_set_font_map`, ...), and the unified `html_to_image` call.
 * Bindings added over time stay optional in the type below; callers must
 * feature-check at runtime (see `./core.ts`).
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
 * Lifecycle bindings are required; feature bindings added over time stay
 * optional and are probed with `typeof` before use.
 */
export interface HtmlToImageModule {
  satoru_create_instance(): WasmInstancePtr;
  satoru_destroy_instance(inst: WasmInstancePtr): void;
  satoru_set_log_level(level: number): void;
  converter_create_instance(): WasmInstancePtr;
  converter_destroy_instance(inst: WasmInstancePtr): void;
  converter_set_log_level(level: number): void;
  /** Registered converter instance ops (real bodies, always present). */
  converter_load_image(
    inst: WasmInstancePtr,
    data: Uint8Array | ArrayBuffer,
  ): boolean;
  converter_crop(
    inst: WasmInstancePtr,
    x: number,
    y: number,
    width: number,
    height: number,
  ): boolean;
  converter_resize(
    inst: WasmInstancePtr,
    width: number,
    height: number,
    fit: number,
  ): boolean;
  /** Image-input svg/pdf wrappers (registered; probed at runtime). */
  converter_encode_svg?(inst: WasmInstancePtr): string | Promise<string>;
  converter_encode_pdf?(inst: WasmInstancePtr): unknown;
  /**
   * HTML resource discovery/injection (registered; probed at runtime).
   * `collect` gathers pending URLs for the HTML, `get_pending_resources`
   * returns them in the binary form (u32 count, then per entry: u8 type
   * 1=font/2=image/3=css, u8 redraw flag, u32+url, u32+name, u32+characters),
   * and `add_resource` injects fetched bytes back (same type ints).
   */
  satoru_collect_resources?(
    inst: WasmInstancePtr,
    html: string,
    width: number,
    height: number,
    mediaType: number,
  ): unknown;
  satoru_get_pending_resources?(inst: WasmInstancePtr): unknown;
  satoru_add_resource?(
    inst: WasmInstancePtr,
    url: string,
    type: number,
    data: Uint8Array,
  ): unknown;
  satoru_load_font?(
    inst: WasmInstancePtr,
    name: string,
    data: Uint8Array,
  ): unknown;
  /** Family -> URL map for generic font resolution (registered). */
  satoru_set_font_map?(
    inst: WasmInstancePtr,
    fontMap: Record<string, string>,
  ): unknown;
  /** User-supplied fallback font bytes (registered; upstream idiom). */
  satoru_load_fallback_font?(inst: WasmInstancePtr, data: Uint8Array): unknown;
  /** HTML render wrapper (positional: instance, htmls, w, h, format, options). */
  satoru_render?: (...args: unknown[]) => unknown;
  /** Image encode wrapper (positional: instance, format, quality, speed, animation). */
  converter_encode?: (...args: unknown[]) => unknown;
  /**
   * Unified Bitmap-direct call (`render_bitmap_to_encoded` exposed to JS,
   * no PNG intermediate round-trip through JS).
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

function isModuleNotFound(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (code === "ERR_MODULE_NOT_FOUND") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Cannot find (module|package)/.test(msg);
}

/** `file://` directory URL to a plain fs path (browser URLs pass through). */
function glueDirToFsPath(glueDir: string): string {
  if (!glueDir.startsWith("file://")) return glueDir;
  let p = decodeURIComponent(glueDir.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // Windows drive letter
  return p;
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

/**
 * Node-only: pre-read the sibling `.wasm` bytes. The web/worker-oriented
 * glue has no `fs` reader, so `file://` fetching fails under Node; handing
 * over `wasmBinary` bypasses fetching entirely. Browsers skip this (fetch
 * works there). No static `node:` import keeps browser bundles clean.
 */
async function readWasmBinaryNode(
  glueDir: string,
): Promise<Uint8Array | undefined> {
  if (!isNodeRuntime()) return undefined;
  try {
    const fs = (await import(/* @vite-ignore */ "node:fs/promises")) as typeof import(
      "node:fs/promises"
    );
    const data = await fs.readFile(
      glueDirToFsPath(glueDir) + "html-to-image.wasm",
    );
    return new Uint8Array(data);
  } catch {
    return undefined;
  }
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
    let glue = String(options.glueUrl ?? defaultGlueUrl());
    let ns: {
      default?: CreateHtmlToImageModule;
      createHtmlToImageModule?: CreateHtmlToImageModule;
    };
    try {
      ns = (await import(/* @vite-ignore */ glue)) as typeof ns;
    } catch (e) {
      if (options.glueUrl || !isModuleNotFound(e)) throw e;
      // Dev-layout fallback: running from `src/` (tsx) while the glue
      // lives in `../dist/` next to the compiled loader.
      const fallback = String(
        new URL("../dist/html-to-image.js", import.meta.url),
      );
      try {
        ns = (await import(/* @vite-ignore */ fallback)) as typeof ns;
      } catch {
        throw e; // report the original error
      }
      glue = fallback;
    }
    glueLabel = glue;
    glueDir = glue.slice(0, glue.lastIndexOf("/") + 1);
    factory = ns.default ?? ns.createHtmlToImageModule;
  }
  if (typeof factory !== "function") {
    throw new Error(
      `wasm-html-to-image: no MODULARIZE factory in ${glueLabel} ` +
        `(expected default export createHtmlToImageModule)`,
    );
  }
  // Node-only: hand over pre-read `.wasm` bytes (factory path, e.g.
  // workerd with `instantiateWasm`, is left untouched).
  let moduleArg = options.moduleArg;
  if (!options.factory && glueDir && moduleArg?.wasmBinary === undefined) {
    const wasmBinary = await readWasmBinaryNode(glueDir);
    if (wasmBinary) moduleArg = { ...moduleArg, wasmBinary };
  }
  const module = await factory({
    ...moduleArg,
    locateFile:
      options.locateFile ??
      moduleArg?.locateFile ??
      ((path: string) => glueDir + path),
  });
  if (!options.noCache) cachedModule = module;
  return module;
}

/** Drop the cached instance (tests / HMR). */
export function dropCachedModule(): void {
  cachedModule = null;
}
