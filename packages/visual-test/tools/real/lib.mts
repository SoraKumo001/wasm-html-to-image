/**
 * Shared pieces of the real-page comparison tools (diff / reduce / score).
 *
 * A page is captured once into a snapshot (`.real-cache/<slug>/`): every response Chromium and the
 * engine asked for. Both sides then render from that snapshot, so a comparison is reproducible,
 * offline, and neither side can see different bytes. Each side reports every element's border box
 * keyed by its path in the shadow-flattened element tree, which `compareBoxes` joins.
 *
 * Chromium always runs with JavaScript off: the engine has none, so the page must not build its
 * DOM differently.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { render, type LayoutBox } from "wasm-html-to-image/single";

export type { LayoutBox };

export const CACHE_DIR = path.resolve(import.meta.dirname, "../../.real-cache");
export const MAX_COMPARE_HEIGHT = 16000; // Chromium repeats content past ~16384px

// ---------------------------------------------------------------------------------------------
// Chromium
// ---------------------------------------------------------------------------------------------

/** `CHROMIUM_PATH`, else the newest Playwright-installed Chromium, else Playwright's own. */
export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "AppData/Local/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

export async function launchChromium(): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath() });
}

// ---------------------------------------------------------------------------------------------
// Snapshot store
// ---------------------------------------------------------------------------------------------

interface Entry {
  file: string;
  type: string;
}
interface Manifest {
  url: string;
  finalUrl: string;
  capturedAt: string;
  entries: Record<string, Entry>;
}

const stripHash = (u: string) => u.split("#")[0];

export function slugOf(url: string): string {
  const u = new URL(url);
  const base = (u.hostname + u.pathname).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const h = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  return `${base}-${h}`;
}

export class Store {
  constructor(
    readonly dir: string,
    readonly manifest: Manifest,
  ) {}
  get url() {
    return this.manifest.url;
  }
  /** The URL both sides navigate to (after redirects), so relative resources resolve alike. */
  get finalUrl() {
    return this.manifest.finalUrl;
  }
  /** Absolute key for a (possibly root- or page-relative) request URL. */
  private key(url: string): string {
    try {
      return stripHash(new URL(url, this.manifest.finalUrl).href);
    } catch {
      return stripHash(url);
    }
  }
  has(url: string): boolean {
    return this.key(url) in this.manifest.entries;
  }
  get(url: string): { body: Buffer; type: string } | undefined {
    const e = this.manifest.entries[this.key(url)];
    if (!e) return undefined;
    return { body: fs.readFileSync(path.join(this.dir, e.file)), type: e.type };
  }
  put(url: string, body: Buffer, type: string) {
    const key = this.key(url);
    if (key in this.manifest.entries) return;
    const file = crypto.createHash("sha1").update(key).digest("hex") + ".bin";
    fs.writeFileSync(path.join(this.dir, file), body);
    this.manifest.entries[key] = { file, type };
  }
  save() {
    fs.writeFileSync(path.join(this.dir, "manifest.json"), JSON.stringify(this.manifest, null, 1));
  }
  size() {
    return Object.keys(this.manifest.entries).length;
  }

  /** `resolveResource` hook for the engine: bytes from the store, nothing else (offline). */
  resolver() {
    return async (url: string): Promise<Uint8Array | null> => {
      const e = this.get(url);
      return e ? new Uint8Array(e.body) : null;
    };
  }

  /** Serve the store to a Chromium context; anything not captured is aborted. */
  async attach(context: BrowserContext) {
    await context.route("**/*", (route) => {
      const e = this.get(route.request().url());
      if (e) route.fulfill({ status: 200, body: e.body, contentType: e.type });
      else route.abort();
    });
  }
}

export function openStore(url: string): Store | undefined {
  const dir = path.join(CACHE_DIR, slugOf(url));
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) return undefined;
  return new Store(dir, JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * Capture `url`: what Chromium loads (JS off) plus whatever the engine asks for on top (its font
 * fallbacks). Reuses an existing snapshot unless `refresh`.
 */
export async function snapshot(url: string, opts: { width?: number; refresh?: boolean } = {}): Promise<Store> {
  const width = opts.width ?? 1000;
  if (!opts.refresh) {
    const have = openStore(url);
    if (have) return have;
  }
  const dir = path.join(CACHE_DIR, slugOf(url));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const store = new Store(dir, { url, finalUrl: url, capturedAt: new Date().toISOString(), entries: {} });

  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 800 } });
    const page = await context.newPage();
    const pending: Promise<void>[] = [];
    page.on("response", (r) => {
      pending.push(
        (async () => {
          if (r.status() < 200 || r.status() >= 300) return;
          const body = await r.body().catch(() => null);
          if (body) store.put(r.url(), body, r.headers()["content-type"] ?? "application/octet-stream");
        })(),
      );
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await Promise.all(pending);
    store.manifest.finalUrl = page.url();
  } finally {
    await browser.close();
  }

  // The engine's own requests (e.g. the Google Fonts css2 it maps generic families to).
  await render({
    url: store.finalUrl,
    width,
    format: "png",
    resolveResource: async (u: string, fallback: () => Promise<Uint8Array | null>) => {
      const have = store.get(u);
      if (have) return new Uint8Array(have.body);
      const got = await fallback();
      if (got) store.put(u, Buffer.from(got), "application/octet-stream");
      return got;
    },
  } as never);
  store.save();
  return store;
}

// ---------------------------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------------------------

export interface Measure {
  png: PNG;
  height: number;
  boxes: LayoutBox[];
}

const whiteBackground = (png: PNG): PNG => {
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(png.data[i + c] * a + 255 * (1 - a));
    png.data[i + 3] = 255;
  }
  return png;
};

export interface Input {
  /** Render this URL (from the store), or ... */
  url?: string;
  /** ... this HTML, resolved against `baseUrl`. */
  html?: string;
  baseUrl?: string;
}

export async function measureOurs(store: Store, input: Input, width: number): Promise<Measure> {
  let boxes: LayoutBox[] = [];
  const common = {
    width,
    format: "png" as const,
    resolveResource: store.resolver(),
    onLayout: (b: LayoutBox[]) => {
      boxes = b;
    },
  };
  const r: any = await render(
    (input.html !== undefined ? { ...common, value: input.html, baseUrl: input.baseUrl ?? store.finalUrl } : { ...common, url: input.url ?? store.finalUrl }) as never,
  );
  const png = whiteBackground(PNG.sync.read(Buffer.from(r.data)));
  return { png, height: r.height, boxes };
}

/** Browser-side walk: the same keys and boxes `onLayout` reports, over the flat tree. */
const GEOMETRY_SOURCE = `(() => {
  const REPLACED = new Set(["img","svg","video","canvas","iframe","input","select","textarea"]);
  const sx = window.scrollX, sy = window.scrollY, out = [];
  const flatKids = (el) => {
    const res = [];
    const expand = (nodes) => {
      for (const n of nodes) {
        if (n.nodeType !== 1) continue;
        if (n.localName === "slot") {
          const assigned = n.assignedNodes ? n.assignedNodes() : [];
          expand(assigned.length ? assigned : Array.from(n.childNodes));
        } else res.push(n);
      }
    };
    expand(el.shadowRoot ? Array.from(el.shadowRoot.childNodes) : Array.from(el.childNodes));
    return res;
  };
  const walk = (el, p) => {
    const cs = getComputedStyle(el);
    const d = cs.display;
    const tag = el.localName;
    // No box (display:none, or inside it): nothing to report, and nothing below it has one either.
    if (d === "none" || (d !== "contents" && el.getClientRects().length === 0)) return;
    if (d !== "contents" && (d !== "inline" || REPLACED.has(tag)) && tag !== "br") {
      const r = el.getBoundingClientRect();
      out.push({ p, t: tag, i: (el.id || "").slice(0, 60), c: (el.getAttribute("class") || "").slice(0, 80),
        x: Math.round((r.x + sx) * 100) / 100, y: Math.round((r.y + sy) * 100) / 100,
        w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 });
    }
    const kids = flatKids(el);
    for (let k = 0; k < kids.length; k++) walk(kids[k], p + "." + k);
  };
  walk(document.documentElement, "0");
  return out;
})()`;

export async function measureChrome(
  browser: Browser,
  store: Store,
  input: Input,
  width: number,
  opts: { screenshot?: boolean } = {},
): Promise<Measure> {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 800 } });
  try {
    await store.attach(context);
    const page: Page = await context.newPage();
    if (input.html !== undefined) {
      const base = input.baseUrl ?? store.finalUrl;
      const withBase = input.html.includes("<base ") ? input.html : input.html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${base}">`);
      await page.route(base, (route) => route.fulfill({ status: 200, contentType: "text/html", body: withBase }));
      await page.goto(base, { waitUntil: "load", timeout: 60000 });
    } else {
      await page.goto(input.url ?? store.finalUrl, { waitUntil: "load", timeout: 60000 });
    }
    const boxes = (await page.evaluate(GEOMETRY_SOURCE)) as LayoutBox[];
    // scrollHeight is floored at the viewport height, so a short page would look taller than it is:
    // beyond the viewport it is the content height, below it the root element's own height.
    const height = (await page.evaluate(
      "(() => { const sh = document.documentElement.scrollHeight; return sh > window.innerHeight ? sh : Math.ceil(document.documentElement.getBoundingClientRect().height); })()",
    )) as number;
    let png = new PNG({ width, height: 1 });
    if (opts.screenshot !== false) {
      const shot = await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width, height: Math.min(height, MAX_COMPARE_HEIGHT) },
      });
      png = PNG.sync.read(shot);
    }
    return { png, height, boxes };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------------------------

export interface BoxDelta {
  p: string;
  t: string;
  i: string;
  c: string;
  /** Chromium box. */
  ref: { x: number; y: number; w: number; h: number };
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface BoxComparison {
  matched: number;
  oursOnly: number;
  chromeOnly: number;
  /** Matched boxes off by more than the tolerance in any of x, y, w, h. */
  bad: BoxDelta[];
  /** Bad boxes whose parent is fine: where a divergence enters the tree. */
  entries: BoxDelta[];
  /** Boxes whose own height differs while no child's does: the likely cause of a height shift. */
  heightCulprits: BoxDelta[];
}

const parentPath = (p: string) => (p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "");
const pathCompare = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

export function compareBoxes(ours: LayoutBox[], chrome: LayoutBox[], tol = 1.5): BoxComparison {
  const o = new Map(ours.map((b) => [b.p, b]));
  const c = new Map(chrome.map((b) => [b.p, b]));
  const deltas = new Map<string, BoxDelta>();
  let oursOnly = 0;
  for (const [p, b] of o) {
    const r = c.get(p);
    if (!r) {
      oursOnly++;
      continue;
    }
    deltas.set(p, {
      p,
      t: r.t,
      i: r.i,
      c: r.c,
      ref: { x: r.x, y: r.y, w: r.w, h: r.h },
      dx: round(b.x - r.x),
      dy: round(b.y - r.y),
      dw: round(b.w - r.w),
      dh: round(b.h - r.h),
    });
  }
  let chromeOnly = 0;
  for (const p of c.keys()) if (!o.has(p)) chromeOnly++;
  const isBad = (d: BoxDelta) => Math.abs(d.dx) > tol || Math.abs(d.dy) > tol || Math.abs(d.dw) > tol || Math.abs(d.dh) > tol;
  const all = [...deltas.values()].sort((a, b) => pathCompare(a.p, b.p));
  const bad = all.filter(isBad);
  const badSet = new Set(bad.map((d) => d.p));
  const entries = bad.filter((d) => !badSet.has(parentPath(d.p)));
  const heightBad = new Set(all.filter((d) => Math.abs(d.dh) > tol).map((d) => d.p));
  const hasBadChild = new Set<string>();
  for (const p of heightBad) hasBadChild.add(parentPath(p));
  const heightCulprits = all.filter((d) => heightBad.has(d.p) && !hasBadChild.has(d.p)).sort((a, b) => a.ref.y - b.ref.y);
  return { matched: deltas.size, oursOnly, chromeOnly, bad, entries, heightCulprits };
}

const round = (v: number) => Math.round(v * 100) / 100;

export interface PixelStats {
  /** Fraction of differing pixels over the compared rows. */
  ratio: number;
  /** Differing-pixel fraction per band of `band` rows. */
  bands: number[];
  band: number;
  rows: number;
}

function crop(png: PNG, rows: number): PNG {
  const out = new PNG({ width: png.width, height: rows });
  out.data.fill(255);
  png.data.copy(out.data, 0, 0, Math.min(png.data.length, png.width * rows * 4));
  return out;
}

export function pixelStats(ours: PNG, chrome: PNG, band = 200): PixelStats {
  const width = Math.min(ours.width, chrome.width);
  const rows = Math.min(Math.max(ours.height, chrome.height), MAX_COMPARE_HEIGHT);
  const fit = (p: PNG) => {
    const c = new PNG({ width, height: rows });
    c.data.fill(255);
    for (let y = 0; y < Math.min(rows, p.height); y++) p.data.copy(c.data, y * width * 4, y * p.width * 4, y * p.width * 4 + width * 4);
    return c;
  };
  const a = fit(ours);
  const b = fit(chrome);
  const diff = new PNG({ width, height: rows });
  const bands: number[] = [];
  const n = pixelmatch(a.data, b.data, diff.data, width, rows, { threshold: 0.15 });
  for (let y0 = 0; y0 < rows; y0 += band) {
    const h = Math.min(band, rows - y0);
    let cnt = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = 0; x < width; x++) if (diff.data[(y * width + x) * 4] > 200 && diff.data[(y * width + x) * 4 + 1] < 100) cnt++;
    bands.push(cnt / (width * h));
  }
  return { ratio: n / (width * rows), bands, band, rows };
}

/** Chromium | engine, side by side, rows y0..y0+h. */
export function sideBySide(chrome: PNG, ours: PNG, y0: number, h: number): PNG {
  const w = Math.max(chrome.width, ours.width);
  const out = new PNG({ width: w * 2 + 8, height: h });
  out.data.fill(200);
  const blit = (s: PNG, ox: number) => {
    for (let y = 0; y < h && y0 + y < s.height; y++) s.data.copy(out.data, (y * out.width + ox) * 4, ((y0 + y) * s.width) * 4, ((y0 + y) * s.width + s.width) * 4);
  };
  blit(chrome, 0);
  blit(ours, w + 8);
  return out;
}

export const ensureDir = (d: string) => fs.mkdirSync(d, { recursive: true });
export { crop };
