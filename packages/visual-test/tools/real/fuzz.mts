/**
 * Differential layout fuzzing: random flex / grid / block trees, engine vs Chromium.
 *
 *   pnpm real:fuzz [--mode all|each|<name>] [--n 200] [--seed 1] [--width 600] [--tol 1.5] [--jobs N] [--verbose]
 *
 * Every case is generated from its seed (reproducible), rendered by both sides with no external
 * resources, and compared box by box with `compareBoxes`. The match rate says how much of the
 * layout space agrees; failing cases are written to `.real-cache/fuzz/` as HTML for `--seed`
 * replay and for reduction. Text is left out on purpose: font differences would swamp the layout
 * differences this is looking for; sizes come from fixed boxes, images and content-sized shells.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser } from "playwright";
import { CACHE_DIR, Store, compareBoxes, ensureDir, launchChromium, measureChrome, measureOurs, type LayoutBox } from "./lib.mts";

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

interface CaseResult {
  mode: string;
  seed: number;
  verdict: "ok" | "bad" | "error";
  info: string;
  bad: number;
}

const outDir = path.join(CACHE_DIR, "fuzz");

/**
 * Chromium's boxes for a page only depend on the HTML and the width, so they are cached by hash:
 * re-running after an engine change only renders the engine side again.
 */
async function chromeBoxes(browser: Browser, store: Store, html: string, width: number): Promise<LayoutBox[]> {
  const key = crypto.createHash("sha1").update(`${width}\n${html}`).digest("hex");
  const file = path.join(outDir, "chrome", `${key}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LayoutBox[];
  } catch {}
  const boxes = (await measureChrome(browser, store, { html }, width, { screenshot: false })).boxes;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(boxes));
  return boxes;
}

/** Run one mode over a seed range in this process. */
async function runCases(mode: string, seed0: number, n: number, width: number, tol: number, verbose: boolean, workerId: string): Promise<CaseResult[]> {
  const dir = path.join(outDir, `store-${workerId}`);
  ensureDir(dir);
  const store = new Store(dir, { url: "http://fuzz.test/", finalUrl: "http://fuzz.test/", capturedAt: "", entries: {} });
  const browser = await launchChromium();
  const results: CaseResult[] = [];
  try {
    for (let s = seed0; s < seed0 + n; s++) {
      const html = generate(s, mode);
      const r: CaseResult = { mode, seed: s, verdict: "ok", info: "", bad: 0 };
      try {
        const ours = await measureOurs(store, { html }, width);
        const chrome = await chromeBoxes(browser, store, html, width);
        const cmp = compareBoxes(ours.boxes, chrome, tol);
        if (cmp.bad.length || cmp.oursOnly || cmp.chromeOnly) {
          r.verdict = "bad";
          r.bad = cmp.bad.length;
          const e = cmp.entries.find((x) => x.p.split(".").length > 2) ?? cmp.entries[0];
          r.info = e ? `${e.p} <${e.t}> dx=${e.dx} dy=${e.dy} dw=${e.dw} dh=${e.dh}` : `structure ours+${cmp.oursOnly} chrome+${cmp.chromeOnly}`;
        }
      } catch (err) {
        r.verdict = "error";
        r.bad = -1;
        r.info = String((err as Error).message).slice(0, 120);
      }
      if (r.verdict !== "ok") fs.writeFileSync(path.join(outDir, `case-${mode}-${s}.html`), html);
      if (verbose) console.error(`[${mode}] seed ${s}: ${r.verdict} ${r.info}`);
      results.push(r);
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** Run a unit of work in a child process; resolves with the results it prints as JSON. */
function runChild(mode: string, seed0: number, n: number, width: number, tol: number, verbose: boolean, id: string): Promise<CaseResult[]> {
  return new Promise((resolve, reject) => {
    const args = [process.argv[1], "--worker", id, "--mode", mode, "--seed", String(seed0), "--n", String(n), "--width", String(width), "--tol", String(tol)];
    if (verbose) args.push("--verbose");
    const child = spawn(process.execPath, [...process.execArgv, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(out.trim().split("\n").pop() ?? "[]"));
      } catch {
        reject(new Error(`worker ${id} exited ${code} without results`));
      }
    });
  });
}

async function main() {
  const n = arg("n", 200);
  const seed0 = arg("seed", 1);
  const width = arg("width", 600);
  const tol = arg("tol", 1.5);
  const verbose = process.argv.includes("--verbose");
  const modeArg = strArg("mode", "all");
  const worker = strArg("worker", "");

  if (worker) {
    // Child: results go to stdout as one JSON line, logs to stderr.
    process.stdout.write(JSON.stringify(await runCases(modeArg, seed0, n, width, tol, verbose, worker)) + "\n");
    return;
  }

  const modes = modeArg === "each" ? Object.keys(MODES) : [modeArg];
  const jobs = Math.max(1, arg("jobs", Math.min(8, Math.floor(os.cpus().length / 2))));
  ensureDir(outDir);

  // Work units: each mode split into chunks, spread over `jobs` processes.
  const chunk = Math.max(5, Math.ceil((n * modes.length) / (jobs * 2)));
  const units: { mode: string; seed: number; n: number }[] = [];
  for (const mode of modes) for (let o = 0; o < n; o += chunk) units.push({ mode, seed: seed0 + o, n: Math.min(chunk, n - o) });

  const t0 = Date.now();
  const all: CaseResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, units.length) }, async (_, w) => {
      while (next < units.length) {
        const u = units[next++];
        all.push(...(await runChild(u.mode, u.seed, u.n, width, tol, verbose, `${w}`)));
      }
    }),
  );

  const summary: Record<string, { ok: number; n: number }> = {};
  for (const m of modes) summary[m] = { ok: 0, n: 0 };
  for (const r of all) {
    summary[r.mode].n++;
    if (r.verdict === "ok") summary[r.mode].ok++;
  }
  const failing = all.filter((r) => r.verdict !== "ok").sort((a, b) => a.mode.localeCompare(b.mode) || a.seed - b.seed);
  if (verbose) for (const f of failing) console.log(`[${f.mode}] seed ${f.seed}: ${f.verdict} ${f.info}`);
  console.log(`\nfuzz (width ${width}, tol ${tol}px, seeds ${seed0}..${seed0 + n - 1}, ${jobs} jobs, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const [m, v] of Object.entries(summary)) console.log(`  ${m.padEnd(12)} ${String(v.ok).padStart(3)}/${v.n}  ${((v.ok / v.n) * 100).toFixed(1)}%`);
  if (failing.length) console.log(`failing cases saved to ${outDir} (replay: pnpm real:fuzz --mode <m> --seed <n> --n 1 --verbose)`);
  fs.writeFileSync(path.join(outDir, "last.json"), JSON.stringify({ n, seed0, width, tol, summary, failing }, null, 1));
}

if (process.argv[1]?.endsWith("fuzz.mts")) await main();
