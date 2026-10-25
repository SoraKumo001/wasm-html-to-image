/**
 * Optional JavaScript execution for HTML input (Node only).
 *
 * The WASM engine never runs scripts. With `javascript` enabled the page is first loaded into jsdom,
 * its scripts run, and the resulting DOM is handed to the renderer as plain HTML. jsdom is an optional
 * peer dependency (imported on demand), so the edge / browser entry points never touch it.
 *
 * jsdom has no layout: scripts that measure the page (getBoundingClientRect, ResizeObserver, ...) see
 * zeros, and `type="module"` scripts are not executed. Scripts run with `runScripts: "dangerously"`, and
 * jsdom is not a security sandbox: do not enable this for URLs you do not trust.
 */
import type { HtmlToImageOptions } from "./core.js";

/** Options of the `javascript` render option. */
export interface JavaScriptOptions {
  /** Upper bound for the whole script phase in ms (default 10000). The page is rendered as it is when it expires. */
  timeout?: number;
  /** Extra time after the `load` event for timers and fetches to finish, in ms (default 1000). */
  settleMs?: number;
  /** CSS selector to wait for after `load`; replaces `settleMs` when given. */
  waitFor?: string;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_SETTLE_MS = 1000;

/** What the script phase produced. */
export interface ScriptedPage {
  /** The DOM after the scripts ran, serialized as HTML. */
  html: string;
  /** The document's final URL (after redirects), for resolving relative resources. */
  baseUrl: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// (typed loosely: the optional peer's typings vary between versions)
async function loadJsdom(): Promise<any> {
  try {
    return await import("jsdom");
  } catch (cause) {
    throw new Error(
      "The `javascript` option needs the optional peer dependency `jsdom` (npm install jsdom).",
      { cause },
    );
  }
}

/**
 * Run a page's scripts in jsdom and return the resulting HTML.
 * Give `url` to fetch the page, or `html` (with an optional `baseUrl`) for markup you already have.
 */
export async function runPageScripts(
  source: { url?: string; html?: string; baseUrl?: string },
  option: true | JavaScriptOptions,
  viewportWidth = 800,
): Promise<ScriptedPage> {
  const opts: JavaScriptOptions = option === true ? {} : option;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const mod = await loadJsdom();
  const { JSDOM, VirtualConsole, ResourceLoader, requestInterceptor } = mod.JSDOM ? mod : mod.default;

  // Only scripts are fetched here: stylesheets, images and fonts are the renderer's job.
  const isFetchable = (element: { localName?: string; type?: string } | null | undefined) =>
    !element || (element.localName === "script" && element.type !== "module");
  let resources: unknown;
  if (typeof requestInterceptor === "function") {
    // jsdom >= 30: resources are configured with undici interceptors.
    resources = {
      interceptors: [
        requestInterceptor((_request: unknown, context: { element?: { localName?: string; type?: string } | null }) =>
          isFetchable(context?.element) ? undefined : new Response("", { status: 204 }),
        ),
      ],
    };
  } else {
    // jsdom < 30: a ResourceLoader subclass.
    class ScriptsOnly extends ResourceLoader {
      fetch(url: string, options: any) {
        return isFetchable(options?.element) ? super.fetch(url, options) : null;
      }
    }
    resources = new ScriptsOnly();
  }
  // Script errors and unimplemented-feature noise must not stop the render.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});

  const jsdomOptions = {
    runScripts: "dangerously" as const,
    resources,
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window: any) {
      try {
        window.innerWidth = viewportWidth;
        window.outerWidth = viewportWidth;
        // jsdom has no matchMedia: answer "no match" so feature checks fall through.
        if (!window.matchMedia) {
          window.matchMedia = (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          });
        }
        for (const name of ["ResizeObserver", "IntersectionObserver"]) {
          if (!window[name]) {
            window[name] = class {
              observe() {}
              unobserve() {}
              disconnect() {}
              takeRecords() {
                return [];
              }
            };
          }
        }
      } catch {
        // a hardened window object: carry on without the shims
      }
    },
  };

  const started = Date.now();
  const remaining = () => Math.max(0, timeout - (Date.now() - started));

  const dom = source.url
    ? await Promise.race([
        JSDOM.fromURL(source.url, jsdomOptions),
        sleep(timeout).then(() => {
          throw new Error(`Timed out loading ${source.url} for the \`javascript\` option (${timeout} ms).`);
        }),
      ])
    : new JSDOM(source.html ?? "", { ...jsdomOptions, url: source.baseUrl || "about:blank" });

  try {
    const { window } = dom;
    if (window.document.readyState !== "complete") {
      await Promise.race([
        new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true })),
        sleep(remaining()),
      ]);
    }
    if (opts.waitFor) {
      while (remaining() > 0 && !window.document.querySelector(opts.waitFor)) await sleep(50);
    } else {
      await sleep(Math.min(opts.settleMs ?? DEFAULT_SETTLE_MS, remaining()));
    }
    // With scripting on, <noscript> content is inert text; the renderer would show it, a browser would not.
    for (const el of Array.from(window.document.querySelectorAll("noscript")) as Element[]) el.remove();
    return { html: dom.serialize(), baseUrl: window.location.href };
  } finally {
    dom.window.close();
  }
}

/**
 * Apply the `javascript` option to render options: HTML and URL inputs are replaced by the scripted DOM.
 * Image and binary inputs, and options without `javascript`, pass through untouched.
 */
export async function applyJavaScript<T extends HtmlToImageOptions>(options: T): Promise<T> {
  const { javascript, ...rest } = options;
  if (!javascript) return options;
  const config = javascript === true ? true : javascript;
  const width = options.width || 800;
  if (options.url) {
    const page = await runPageScripts({ url: options.url }, config, width);
    return { ...rest, url: undefined, value: page.html, baseUrl: options.baseUrl ?? page.baseUrl } as unknown as T;
  }
  if (typeof options.value === "string" && !options.value.startsWith("data:image/")) {
    const page = await runPageScripts({ html: options.value, baseUrl: options.baseUrl }, config, width);
    return { ...rest, value: page.html, baseUrl: options.baseUrl ?? page.baseUrl } as unknown as T;
  }
  return rest as unknown as T;
}
