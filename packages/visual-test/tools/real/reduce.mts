/**
 * Shrink a real-page divergence to a minimal HTML/CSS case.
 *
 *   pnpm real:reduce <url> (--select "<css selector>" | --path 0.1.2.1) [--prop h|w|x|y] [--min 2]
 *                    [--ancestors 2] [--width 1000] [--max-trials 300] [--out dir]
 *
 * Extracts the first element matching the selector (plus a few ancestors) and the stylesheet rules
 * that can touch it, then delta-debugs the rules and the markup: a candidate is kept while the
 * element's `--prop` (default h) still differs between the engine and Chromium by at least
 * `--min` px, in the same direction as the original. Each trial renders both sides from the page
 * snapshot, so no network and no wasm rebuild are involved.
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, ensureDir, launchChromium, measureChrome, measureOurs, slugOf, snapshot, type Store } from "./lib.mts";
import type { Browser } from "playwright";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const url = process.argv[2];
// A path as printed by real:diff ("0.1.2.1": element-child indexes from <html>) becomes a selector.
const pathArg = arg("path");
const selector =
  arg("select") ??
  (pathArg
    ? pathArg
        .split(".")
        .slice(1)
        .reduce((sel, i) => `${sel} > :nth-child(${Number(i) + 1})`, "html")
    : undefined);
if (!url || url.startsWith("--") || !selector) {
  console.error('usage: real:reduce <url> (--select "<css selector>" | --path 0.1.2.1) [--prop h|w|x|y] [--min 2] [--ancestors 2] [--width 1000] [--max-trials 300] [--out dir]');
  process.exit(2);
}
const prop = (arg("prop", "h") ?? "h") as "h" | "w" | "x" | "y";
const minDelta = Number(arg("min", "2"));
const ancestors = Number(arg("ancestors", "2"));
const width = Number(arg("width", "1000"));
const budget = { left: Number(arg("max-trials", "300")) };
const outDir = arg("out") ?? path.join(CACHE_DIR, slugOf(url), "reduce");

const store: Store = await snapshot(url, { width });
const browser: Browser = await launchChromium();

// ---------------------------------------------------------------------------------------------
// Extraction (in Chromium, from the snapshot)
// ---------------------------------------------------------------------------------------------

interface Extracted {
  htmlAttrs: string;
  bodyAttrs: string;
  links: string[];
  cssUnits: string[];
  wrapper: { x: number; w: number };
  /** Opening tags of the kept ancestors, outermost first, and the target's outerHTML. */
  openTags: string[];
  closeTags: string[];
  target: string;
}

const attrsOf = `(el) => Array.from(el.attributes).map((a) => a.name + '="' + a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + '"').join(" ")`;

const EXTRACT = `(() => {
  const sel = ${JSON.stringify(selector)}, anc = ${ancestors};
  const attrsOf = ${attrsOf};
  const el = document.querySelector(sel);
  if (!el) return { error: "selector matched nothing" };
  const ancestors = [];
  for (let a = el.parentElement, n = 0; a && a !== document.body && n < anc; a = a.parentElement, n++) ancestors.push(a);
  const strip = (s) => s.replace(/::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)\\b/g, "");
  const test = (s) => {
    s = strip(s);
    try {
      if (document.documentElement.matches(s) || document.body.matches(s)) return true;
      if (el.matches(s) || el.querySelector(s)) return true;
      return ancestors.some((a) => a.matches(s));
    } catch (e) { return true; }
  };
  const units = [], links = [];
  const walk = (rules, wrap) => {
    for (const r of rules) {
      const k = r.constructor.name;
      if (k === "CSSStyleRule") { if (test(r.selectorText)) units.push(wrap.reduceRight((acc, w) => w + "{" + acc + "}", r.cssText)); }
      else if (k === "CSSMediaRule") walk(r.cssRules, wrap.concat("@media " + r.media.mediaText));
      else if (k === "CSSSupportsRule") walk(r.cssRules, wrap.concat("@supports " + r.conditionText));
      else if (k === "CSSLayerBlockRule") walk(r.cssRules, wrap.concat("@layer " + r.name));
      else if (k === "CSSContainerRule") walk(r.cssRules, wrap.concat("@container " + r.conditionText));
      else if (k === "CSSLayerStatementRule" || k === "CSSFontFaceRule" || k === "CSSPropertyRule") units.push(wrap.reduceRight((acc, w) => w + "{" + acc + "}", r.cssText));
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) { rules = null; }
    if (rules) walk(rules, []);
    else if (sheet.href) links.push(sheet.href);
  }
  const outer = ancestors.length ? ancestors[ancestors.length - 1] : el;
  const r = outer.getBoundingClientRect();
  const chain = ancestors.slice().reverse();
  return {
    htmlAttrs: attrsOf(document.documentElement), bodyAttrs: attrsOf(document.body), links, cssUnits: units,
    wrapper: { x: Math.round(r.x + window.scrollX), w: Math.round(r.width) },
    openTags: chain.map((a) => "<" + a.localName + " " + attrsOf(a) + ">"),
    closeTags: chain.map((a) => "</" + a.localName + ">").reverse(),
    target: el.outerHTML,
  };
})()`;

async function extract(): Promise<Extracted> {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 800 } });
  try {
    await store.attach(context);
    const page = await context.newPage();
    await page.goto(store.finalUrl, { waitUntil: "load", timeout: 60000 });
    const r = (await page.evaluate(EXTRACT)) as Extracted & { error?: string };
    if (r.error) throw new Error(r.error);
    return r;
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------

const ex = await extract();
const targetPath = "0.1" + ".0".repeat(ex.openTags.length + 2);

function build(cssUnits: string[], target: string): string {
  return (
    `<!DOCTYPE html><html ${ex.htmlAttrs}><head><meta charset="utf-8"><base href="${store.finalUrl}">` +
    ex.links.map((l) => `<link rel="stylesheet" href="${l}">`).join("") +
    `<style>\n${cssUnits.join("\n")}\n</style></head><body ${ex.bodyAttrs}>` +
    `<div style="width:${ex.wrapper.w}px;margin-left:${ex.wrapper.x}px">${ex.openTags.join("")}${target}${ex.closeTags.join("")}</div></body></html>`
  );
}

async function delta(html: string): Promise<number | undefined> {
  try {
    const [o, c] = await Promise.all([
      measureOurs(store, { html }, width),
      measureChrome(browser, store, { html }, width, { screenshot: false }),
    ]);
    const bo = o.boxes.find((b) => b.p === targetPath);
    const bc = c.boxes.find((b) => b.p === targetPath);
    if (!bo || !bc) return undefined;
    return bo[prop] - bc[prop];
  } catch {
    return undefined;
  }
}

const d0 = await delta(build(ex.cssUnits, ex.target));
if (d0 === undefined || Math.abs(d0) < minDelta) {
  console.error(`the extracted case does not reproduce: delta(${prop}) = ${d0} (need |delta| >= ${minDelta}). Try more --ancestors, or another selector.`);
  await browser.close();
  process.exit(1);
}
const need = Math.max(minDelta, Math.abs(d0) / 2);
console.log(`target ${selector} -> ${targetPath}; ${ex.cssUnits.length} CSS rules, ${ex.target.length} bytes of markup; delta(${prop}) = ${d0}; keep while same sign and |delta| >= ${need}`);

let trials = 0;
async function stillBroken(css: string[], target: string): Promise<boolean> {
  if (budget.left <= 0) return false;
  budget.left--;
  trials++;
  const d = await delta(build(css, target));
  return d !== undefined && Math.sign(d) === Math.sign(d0!) && Math.abs(d) >= need;
}

/** Remove complements of chunks while `test` holds; ends 1-minimal (or out of budget). */
async function ddmin<T>(items: T[], test: (subset: T[]) => Promise<boolean>): Promise<T[]> {
  let n = 2;
  while (items.length >= 2 && budget.left > 0) {
    const size = Math.ceil(items.length / n);
    let reduced = false;
    for (let i = 0; i < items.length; i += size) {
      const complement = items.slice(0, i).concat(items.slice(i + size));
      if (complement.length && (await test(complement))) {
        items = complement;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (n >= items.length) break;
      n = Math.min(items.length, n * 2);
    }
  }
  return items;
}

// --- markup: remove sets of children, level by level --------------------------------------------

const removeFragment = (html: string, paths: string[]) => `(() => {
  const t = document.createElement("template");
  t.innerHTML = ${JSON.stringify(html)};
  const root = t.content.firstElementChild;
  const at = (p) => p.split(".").filter(Boolean).reduce((n, i) => n && n.children[Number(i)], root);
  const gone = ${JSON.stringify(paths)}.map(at).filter(Boolean);
  for (const n of gone) n.remove();
  return t.innerHTML;
})()`;

const toolPage = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
const mutate = async (html: string, paths: string[]) => (await toolPage.evaluate(removeFragment(html, paths))) as string;
const childCount = async (html: string, p: string) =>
  (await toolPage.evaluate(`(() => { const t = document.createElement("template"); t.innerHTML = ${JSON.stringify(html)};
    const n = ${JSON.stringify(p)}.split(".").filter(Boolean).reduce((n, i) => n && n.children[Number(i)], t.content.firstElementChild);
    return n ? n.children.length : 0; })()`)) as number;

async function reduceMarkup(css: string[], target: string): Promise<string> {
  let html = target;
  const visit = async (p: string) => {
    const count = await childCount(html, p);
    if (count === 0 || budget.left <= 0) return;
    const idx = Array.from({ length: count }, (_, i) => i);
    const keep = await ddmin(idx, async (subset) => {
      const gone = idx.filter((i) => !subset.includes(i)).map((i) => (p ? p + "." : "") + i);
      return stillBroken(css, await mutate(html, gone));
    });
    const gone = idx.filter((i) => !keep.includes(i)).map((i) => (p ? p + "." : "") + i);
    if (gone.length) html = await mutate(html, gone);
    // survivors were renumbered: visit by their new positions
    const n = await childCount(html, p);
    for (let i = 0; i < n; i++) await visit((p ? p + "." : "") + i);
  };
  await visit("");
  return html;
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

let css = ex.cssUnits;
let target = ex.target;
console.log("\n1/3 stylesheet rules ...");
css = await ddmin(css, (subset) => stillBroken(subset, target));
console.log(`    ${ex.cssUnits.length} -> ${css.length} rules  (${trials} trials)`);
console.log("2/3 markup ...");
target = await reduceMarkup(css, target);
console.log(`    ${ex.target.length} -> ${target.length} bytes  (${trials} trials)`);
console.log("3/3 stylesheet rules again ...");
css = await ddmin(css, (subset) => stillBroken(subset, target));
console.log(`    -> ${css.length} rules  (${trials} trials, ${budget.left} left)`);

const finalHtml = build(css, target);
const dEnd = await delta(finalHtml);
ensureDir(outDir);
const file = path.join(outDir, "reduced.html");
fs.writeFileSync(file, finalHtml);
await browser.close();
console.log(`\ndelta(${prop}) ${d0} -> ${dEnd}`);
console.log(`wrote ${path.relative(process.cwd(), file)}  (${finalHtml.length} bytes)`);
console.log(`target path in the page: ${targetPath}; relative resources resolve against ${store.finalUrl}`);
