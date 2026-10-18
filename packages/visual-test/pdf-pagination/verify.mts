// P1 verification (extended): per-page slice distinctness, header/footer per-page redraw,
// fixed redraw per page, and still page-count/text parity vs Chromium.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { render } from "wasm-html-to-image/single";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });
const WIDTH = 600;
const PAGE_H = 1123;

function parseObjects(buf: Buffer) {
  const latin = buf.toString("latin1");
  const objRe = /(\d+)\s+0\s+obj/g;
  const pos: { num: number; start: number; dictStart: number }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = objRe.exec(latin))) pos.push({ num: +mm[1], start: mm.index, dictStart: mm.index + mm[0].length });
  const objs = new Map<number, { dict: string; stream: string | null }>();
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const end = i + 1 < pos.length ? pos[i + 1].start : latin.length;
    const slice = latin.slice(p.dictStart, end);
    const si = slice.indexOf("stream");
    let dict: string;
    let stream: string | null = null;
    if (si >= 0) {
      dict = slice.slice(0, si);
      let q = p.dictStart + si + "stream".length;
      if (buf[q] === 0x0d) q++;
      if (buf[q] === 0x0a) q++;
      const e = buf.indexOf("endstream", q, "latin1");
      const raw = buf.subarray(q, e);
      try { stream = zlib.inflateSync(raw).toString("latin1"); } catch { stream = raw.toString("latin1"); }
    } else dict = slice;
    objs.set(p.num, { dict, stream });
  }
  return objs;
}
const hexToStr = (hex: string) => { let o = ""; for (let i = 0; i + 4 <= hex.length; i += 4) o += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return o; };
function parseCMap(s: string) {
  const map = new Map<number, string>();
  let codeLen = 1;
  const csr = s.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (csr) { const f = csr[1].match(/<([0-9A-Fa-f]+)>/); if (f) codeLen = Math.max(1, f[1].length / 2); }
  for (const b of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const l of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(l[1], 16), hexToStr(l[2]));
  for (const b of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const l of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(l[1], 16), hi = parseInt(l[2], 16);
      if (l[3] !== undefined) { const base = parseInt(l[3], 16); for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo))); }
      else { const arr = [...l[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToStr(x[1])); arr.forEach((v, i) => map.set(lo + i, v)); }
    }
  return { map, codeLen };
}
function extractPdf(pdf: Buffer): { pages: string[] } {
  const objs = parseObjects(pdf);
  const refs = (dict: string, key: string): number[] => {
    const m = dict.match(new RegExp(`/${key}\\s*(\\[[^\\]]*\\]|\\d+\\s+0\\s+R)`));
    return m ? [...m[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => +x[1]) : [];
  };
  const pageObjs = [...objs.values()].filter((o) => /\/Type\s*\/Page[^s]/.test(o.dict));
  const pages: string[] = [];
  for (const page of pageObjs) {
    const fontM = page.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
    const fonts = new Map<string, { map: Map<number, string>; codeLen: number }>();
    if (fontM) for (const f of fontM[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g)) {
      const fo = objs.get(+f[2]); if (!fo) continue;
      const tu = fo.dict.match(/\/ToUnicode\s+(\d+)\s+0\s+R/); if (!tu) continue;
      const co = objs.get(+tu[1]); if (co?.stream) fonts.set(f[1], parseCMap(co.stream));
    }
    let text = "";
    for (const cRef of refs(page.dict, "Contents")) {
      const content = objs.get(cRef)?.stream ?? "";
      let cur: { map: Map<number, string>; codeLen: number } | null = null;
      for (const line of content.split("\n")) {
        const tf = line.match(/\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf/);
        if (tf) cur = fonts.get(tf[1]) ?? null;
        const tj = line.match(/<([0-9A-Fa-f]+)>\s*Tj/);
        if (tj && cur) { const hx = tj[1]; for (let i = 0; i + cur.codeLen * 2 <= hx.length; i += cur.codeLen * 2) text += cur.map.get(parseInt(hx.slice(i, i + cur.codeLen * 2), 16)) ?? ""; }
      }
    }
    pages.push(text);
  }
  return { pages };
}
const strip = (s: string) => s.replace(/\s/g, "");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const img = new PNG({ width: 300, height: 600 });
for (let y = 0; y < 600; y++) for (let x = 0; x < 300; x++) { const i = (y * 300 + x) << 2; img.data[i] = (x * 255 / 300) | 0; img.data[i + 1] = (y * 255 / 600) | 0; img.data[i + 2] = 128; img.data[i + 3] = 255; }
const dataUri = `data:image/png;base64,${PNG.sync.write(img).toString("base64")}`;
const style = "margin:0;font-family:sans-serif;font-size:20px";

const cases: Record<string, string> = {
  short: `<html><body style="${style}"><h1 style="margin:0">Short Title</h1><p style="margin:0">A short document on one page.</p></body></html>`,
  long: `<html><body style="${style}"><h1 style="margin:0">Long Doc</h1><div style="height:900px">block one</div><div style="height:900px">block two</div><div style="height:900px">block three</div><p style="margin:0">Tail line end</p></body></html>`,
  image: `<html><body style="${style}"><h1 style="margin:0">Image Mixed</h1><img src="${dataUri}" style="width:300px;height:600px"><div style="height:900px">after image</div><p style="margin:0">Tail after image</p></body></html>`,
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "C:/Users/oikawa/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe" });
let ok = true;
for (const [name, html] of Object.entries(cases)) {
  const r = await render({ value: html, width: WIDTH, format: "pdf" });
  const pdf = Buffer.from(r.data as Uint8Array);
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
  const eng = extractPdf(pdf);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html);
  await page.goto(pathToFileURL(file).toString());
  await page.waitForTimeout(300);
  const domText = await page.evaluate(() => document.body.innerText);
  const chrom = extractPdf(Buffer.from(await page.pdf({ width: `${WIDTH}px`, height: `${PAGE_H}px`, margin: { top: "0", right: "0", bottom: "0", left: "0" }, printBackground: true })));
  await ctx.close();
  const pagesOk = eng.pages.length === chrom.pages.length;
  const textOk = strip(eng.pages.join("")) === strip(domText);
  const distinct = new Set(eng.pages.map(norm)).size === eng.pages.length;
  if (!pagesOk || !textOk || !distinct) ok = false;
  console.log(`${name.padEnd(7)} pages eng=${eng.pages.length} chrom=${chrom.pages.length} ${pagesOk ? "OK" : "MISMATCH"} | text ${textOk ? "OK" : "MISMATCH"} | slices distinct ${distinct ? "OK" : "SAME"}`);
  eng.pages.forEach((t, i) => console.log(`   p${i + 1}: ${JSON.stringify(norm(t))}`));
}

// header/footer per-page redraw
const hfHtml = `<html><body style="${style}"><div style="height:2500px">body content</div></body></html>`;
const hf = await render({
  value: hfHtml, width: WIDTH, format: "pdf",
  pdfHeader: `<div style="text-align:right">Page {{pageNumber}}</div>`,
  pdfFooter: `<div>total {{totalPages}}</div>`,
  pdfMargin: { top: 0, right: 0, bottom: 40, left: 0 },
} as never);
const hfPages = extractPdf(Buffer.from(hf.data as Uint8Array)).pages;
const hfOk = hfPages.length === 3 && hfPages.every((t, i) => norm(t).includes(`Page ${i + 1}`) && norm(t).includes("total 3"));
if (!hfOk) ok = false;
console.log(`header/footer pages=${hfPages.length} ${hfOk ? "OK" : "MISMATCH"}`);
hfPages.forEach((t, i) => console.log(`   p${i + 1}: ${JSON.stringify(norm(t))}`));

// position:fixed redraw per page (engine: appears on every page; Chromium print does too)
const fixedHtml = `<html><body style="${style}"><div style="position:fixed;top:10px;right:10px">FIXEDMARK</div><div style="height:2500px">flow content</div></body></html>`;
const fx = await render({ value: fixedHtml, width: WIDTH, format: "pdf" });
const fxPages = extractPdf(Buffer.from(fx.data as Uint8Array)).pages;
const fxOk = fxPages.length === 3 && fxPages.every((t) => norm(t).includes("FIXEDMARK"));
if (!fxOk) ok = false;
console.log(`fixed pages=${fxPages.length} onEveryPage=${fxOk ? "OK" : "MISMATCH"}`);
fxPages.forEach((t, i) => console.log(`   p${i + 1}: ${JSON.stringify(norm(t))}`));

await browser.close();
console.log(ok ? "ALL OK" : "FAILURES PRESENT");
