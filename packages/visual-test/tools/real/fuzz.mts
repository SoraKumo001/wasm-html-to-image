/**
 * Differential layout fuzzing: random flex / grid / block trees, engine vs Chromium.
 *
 *   pnpm real:fuzz [--n 200] [--seed 1] [--width 600] [--tol 1.5] [--keep]
 *
 * Every case is generated from its seed (reproducible), rendered by both sides with no external
 * resources, and compared box by box with `compareBoxes`. The match rate says how much of the
 * layout space agrees; failing cases are written to `.real-cache/fuzz/` as HTML for `--seed`
 * replay and for reduction. Text is left out on purpose: font differences would swamp the layout
 * differences this is looking for; sizes come from fixed boxes, images and content-sized shells.
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, Store, compareBoxes, ensureDir, launchChromium, measureChrome, measureOurs } from "./lib.mts";

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

const svgUri = (w: number, h: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#69c"/></svg>`)}`;

const COLORS = ["#fdd", "#dfd", "#ddf", "#ffd", "#dff", "#fdf", "#eee", "#fed"];

type Kind = "block" | "flex" | "flex-col" | "grid" | "inline-block" | "inline-flex" | "float" | "abs";

/** Which containers and leaves a mode may use; each mode isolates one feature family. */
const MODES: Record<string, { kinds: Kind[]; leaves: number[] }> = {
  flex: { kinds: ["flex", "flex", "flex-col", "block"], leaves: [2, 3, 4] },
  "flex-inline": { kinds: ["flex", "flex-col", "inline-flex", "block"], leaves: [2, 3, 4] },
  grid: { kinds: ["grid", "grid", "block"], leaves: [2, 3, 4] },
  "grid-flex": { kinds: ["grid", "flex", "flex-col", "block"], leaves: [2, 3, 4] },
  block: { kinds: ["block", "block"], leaves: [2, 3, 4] },
  float: { kinds: ["block", "float", "inline-block"], leaves: [2, 3, 4] },
  abs: { kinds: ["block", "abs"], leaves: [2, 3, 4] },
  replaced: { kinds: ["block", "flex", "grid"], leaves: [0, 1] },
  all: { kinds: ["block", "flex", "flex", "flex-col", "grid", "grid", "inline-block", "inline-flex", "float", "abs"], leaves: [0, 1, 2, 3, 4] },
};

interface Ctx {
  r: Rng;
  budget: number;
  kinds: Kind[];
  leaves: number[];
}

const size = (r: Rng, allowAuto = true): string => {
  const v = r.int(0, allowAuto ? 7 : 5);
  if (v <= 2) return `${r.pick([20, 40, 60, 80, 120, 200])}px`;
  if (v === 3) return `${r.pick([25, 50, 100])}%`;
  if (v === 4) return "fit-content";
  if (v === 5) return `${r.pick([10, 30])}%`;
  return "auto";
};

const spacing = (r: Rng, name: string): string => (r.chance(0.35) ? `${name}:${r.pick([2, 4, 8, 12])}px;` : "");

function leaf(c: Ctx): string {
  const r = c.r;
  const color = r.pick(COLORS);
  switch (r.pick(c.leaves)) {
    case 0: {
      const w = r.pick([20, 40, 80, 120, 300]);
      const h = r.pick([10, 30, 50, 90]);
      return `<img src="${svgUri(w, h)}" ${r.chance(0.3) ? `style="width:${size(r, false)}"` : ""}>`;
    }
    case 1: {
      // viewBox-only svg: ratio sized
      const w = r.pick([40, 100]);
      const h = r.pick([20, 60]);
      return `<svg viewBox="0 0 ${w} ${h}" style="${r.chance(0.5) ? `width:${size(r, false)};` : ""}"><rect width="${w}" height="${h}" fill="#69c"/></svg>`;
    }
    case 2:
      return `<div style="background:${color};width:${r.pick([20, 50, 90])}px;height:${r.pick([10, 25, 40])}px;${r.chance(0.3) ? `flex:${r.pick(["1", "0 0 40px", "2 1 0", "0 1 100px"])};` : ""}"></div>`;
    case 3:
      return `<div style="background:${color};min-width:${r.pick([10, 40])}px;min-height:${r.pick([10, 30])}px;${spacing(r, "padding")}"></div>`;
    default:
      return `<div style="background:${color};height:${r.pick([12, 24, 36])}px;${spacing(r, "margin")}"></div>`;
  }
}

function container(c: Ctx, depth: number): string {
  const r = c.r;
  const kind = r.pick(c.kinds);
  const st: string[] = [`background:${r.pick(COLORS)}`];
  switch (kind) {
    case "block":
      break;
    case "inline-block":
      st.push("display:inline-block");
      break;
    case "float":
      st.push(`float:${r.pick(["left", "right"])}`);
      break;
    case "abs":
      st.push("position:absolute", `left:${r.pick([0, 10, 30])}px`, `top:${r.pick([0, 10, 30])}px`);
      break;
    case "flex":
    case "inline-flex":
    case "flex-col": {
      st.push(`display:${kind === "inline-flex" ? "inline-flex" : "flex"}`);
      if (kind === "flex-col") st.push("flex-direction:column");
      else if (r.chance(0.2)) st.push(`flex-direction:${r.pick(["row-reverse"])}`);
      if (r.chance(0.3)) st.push("flex-wrap:wrap");
      if (r.chance(0.5)) st.push(`justify-content:${r.pick(["flex-start", "center", "flex-end", "space-between", "space-around"])}`);
      if (r.chance(0.5)) st.push(`align-items:${r.pick(["flex-start", "center", "flex-end", "stretch", "baseline"])}`);
      if (r.chance(0.3)) st.push(`gap:${r.pick([4, 8, 16])}px`);
      break;
    }
    case "grid": {
      st.push("display:grid");
      const cols = r.int(1, 4);
      const tracks = Array.from({ length: cols }, () => r.pick(["1fr", "1fr", "2fr", "auto", "auto", "60px", "minmax(40px,1fr)", "min-content", "max-content", "fit-content(80px)"]));
      st.push(`grid-template-columns:${r.chance(0.2) ? `repeat(${cols},${r.pick(["1fr", "auto", "50px"])})` : tracks.join(" ")}`);
      if (r.chance(0.3)) st.push(`grid-auto-rows:${r.pick(["auto", "40px", "minmax(30px,auto)"])}`);
      if (r.chance(0.3)) st.push(`gap:${r.pick([4, 8, 16])}px`);
      if (r.chance(0.3)) st.push(`align-items:${r.pick(["start", "center", "end", "stretch"])}`);
      if (r.chance(0.2)) st.push(`justify-items:${r.pick(["start", "center", "stretch"])}`);
      break;
    }
  }
  if (r.chance(0.6)) st.push(`width:${size(r)}`);
  if (r.chance(0.3)) st.push(`height:${size(r)}`);
  if (r.chance(0.2)) st.push(`min-width:${r.pick([40, 100])}px`);
  if (r.chance(0.15)) st.push(`max-width:${r.pick([150, 250])}px`);
  const pad = spacing(r, "padding");
  if (pad) st.push(pad.slice(0, -1));
  const mar = spacing(r, "margin");
  if (mar) st.push(mar.slice(0, -1));
  if (r.chance(0.2)) st.push(`flex:${r.pick(["1", "none", "0 1 auto", "1 1 0", "2"])}`);
  if (r.chance(0.1)) st.push(`overflow:hidden`);

  const n = r.int(1, 4);
  const kids: string[] = [];
  for (let i = 0; i < n; i++) kids.push(child(c, depth + 1));
  return `<div style="${st.join(";")}">${kids.join("")}</div>`;
}

function child(c: Ctx, depth: number): string {
  c.budget--;
  if (depth >= 4 || c.budget <= 0 || c.r.chance(0.35)) return leaf(c);
  return container(c, depth);
}

export function generate(seed: number, mode = "all"): string {
  const r = rng(seed);
  const m = MODES[mode] ?? MODES.all;
  const c: Ctx = { r, budget: 14, kinds: m.kinds, leaves: m.leaves };
  const root = container(c, 0);
  return `<!doctype html><html><head><style>*{box-sizing:${r.chance(0.5) ? "border-box" : "content-box"}}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${root}</body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

function strArg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const n = arg("n", 200);
  const seed0 = arg("seed", 1);
  const width = arg("width", 600);
  const tol = arg("tol", 1.5);
  const modeArg = strArg("mode", "all");
  const modes = modeArg === "each" ? Object.keys(MODES) : [modeArg];
  const outDir = path.join(CACHE_DIR, "fuzz");
  ensureDir(outDir);
  const dir = path.join(outDir, "store");
  ensureDir(dir);
  const store = new Store(dir, { url: "http://fuzz.test/", finalUrl: "http://fuzz.test/", capturedAt: "", entries: {} });

  const browser = await launchChromium();
  const summary: Record<string, { ok: number; n: number }> = {};
  const failing: { mode: string; seed: number; bad: number; entry: string }[] = [];
  try {
    for (const mode of modes) {
      let ok = 0;
      for (let s = seed0; s < seed0 + n; s++) {
        const html = generate(s, mode);
        let verdict: "ok" | "bad" | "error" = "ok";
        let info = "";
        try {
          const ours = await measureOurs(store, { html }, width);
          const chrome = await measureChrome(browser, store, { html }, width, { screenshot: false });
          const cmp = compareBoxes(ours.boxes, chrome.boxes, tol);
          if (cmp.bad.length || cmp.oursOnly || cmp.chromeOnly) {
            verdict = "bad";
            const e = cmp.entries.find((x) => x.p.split(".").length > 2) ?? cmp.entries[0];
            info = e ? `${e.p} <${e.t}> dx=${e.dx} dy=${e.dy} dw=${e.dw} dh=${e.dh}` : `structure ours+${cmp.oursOnly} chrome+${cmp.chromeOnly}`;
            failing.push({ mode, seed: s, bad: cmp.bad.length, entry: info });
          }
        } catch (err) {
          verdict = "error";
          info = String((err as Error).message).slice(0, 120);
          failing.push({ mode, seed: s, bad: -1, entry: `error: ${info}` });
        }
        if (verdict === "ok") ok++;
        else fs.writeFileSync(path.join(outDir, `case-${mode}-${s}.html`), html);
        if (process.argv.includes("--verbose")) console.log(`[${mode}] seed ${s}: ${verdict} ${info}`);
      }
      summary[mode] = { ok, n };
    }
  } finally {
    await browser.close();
  }
  console.log(`
fuzz (width ${width}, tol ${tol}px, seeds ${seed0}..${seed0 + n - 1})`);
  for (const [m, v] of Object.entries(summary)) console.log(`  ${m.padEnd(12)} ${String(v.ok).padStart(3)}/${v.n}  ${((v.ok / v.n) * 100).toFixed(1)}%`);
  if (failing.length) console.log(`failing cases saved to ${outDir} (replay: pnpm real:fuzz --mode <m> --seed <n> --n 1 --verbose)`);
  fs.writeFileSync(path.join(outDir, "last.json"), JSON.stringify({ n, seed0, width, tol, summary, failing }, null, 1));
}

if (process.argv[1]?.endsWith("fuzz.mts")) await main();
