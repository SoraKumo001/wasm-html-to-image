/**
 * Scoreboard: how close the engine is to Chromium across a set of real pages, and whether a change
 * made any of them worse.
 *
 *   pnpm real:score [--only nodejs,mdn] [--refresh] [--update] [--timeout 240]
 *
 * Every site in sites.json is snapshotted once (`.real-cache/`), then rendered by both sides. Per
 * site: height ratio, share of differing pixels, share of boxes off by more than 1.5px. The result
 * is compared with the last `--update` baseline; any site that got worse is listed and the exit
 * code is 1. Each site runs in its own process with a timeout, so one hang cannot sink the run.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_DIR, compareBoxes, ensureDir, launchChromium, measureChrome, measureOurs, pixelStats, snapshot } from "./lib.mts";

interface Site {
  name: string;
  url: string;
  width: number;
}
interface Score {
  name: string;
  ok: boolean;
  error?: string;
  chromeHeight?: number;
  oursHeight?: number;
  /** ours / chromium */
  heightRatio?: number;
  /** Differing pixels over the compared rows, 0..1. */
  pixels?: number;
  /** Matched boxes off by more than 1.5px, 0..1. */
  badBoxes?: number;
  /** Boxes found on one side only, as a share of all boxes, 0..1. */
  unmatched?: number;
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// --- one site (child process) ---------------------------------------------------------------
if (flag("one")) {
  const url = arg("one")!;
  const width = Number(arg("width", "1000"));
  const name = arg("name", url)!;
  let score: Score;
  try {
    const store = await snapshot(url, { width, refresh: flag("refresh") });
    const browser = await launchChromium();
    let chrome;
    try {
      chrome = await measureChrome(browser, store, { url: store.finalUrl }, width);
    } finally {
      await browser.close();
    }
    const ours = await measureOurs(store, { url: store.finalUrl }, width);
    const cmp = compareBoxes(ours.boxes, chrome.boxes);
    const px = pixelStats(ours.png, chrome.png);
    const total = cmp.matched + cmp.oursOnly + cmp.chromeOnly;
    score = {
      name,
      ok: true,
      chromeHeight: chrome.height,
      oursHeight: ours.height,
      heightRatio: Math.round((ours.height / chrome.height) * 1000) / 1000,
      pixels: Math.round(px.ratio * 10000) / 10000,
      badBoxes: cmp.matched ? Math.round((cmp.bad.length / cmp.matched) * 1000) / 1000 : 1,
      unmatched: total ? Math.round(((cmp.oursOnly + cmp.chromeOnly) / total) * 1000) / 1000 : 0,
    };
  } catch (e) {
    score = { name, ok: false, error: String((e as Error).message ?? e).slice(0, 200) };
  }
  console.log("SCORE:" + JSON.stringify(score));
  process.exit(0);
}

// --- all sites ------------------------------------------------------------------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const sites: Site[] = JSON.parse(fs.readFileSync(path.join(here, "sites.json"), "utf8"));
const only = arg("only")?.split(",");
const timeout = Number(arg("timeout", "240")) * 1000;
const scoresDir = path.join(CACHE_DIR, "scores");
const baselineFile = path.join(scoresDir, "baseline.json");
ensureDir(scoresDir);

const results: Score[] = [];
for (const site of sites.filter((s) => !only || only.includes(s.name))) {
  process.stdout.write(`${site.name.padEnd(12)}`);
  const t0 = Date.now();
  const args = ["--import", "tsx", fileURLToPath(import.meta.url), "--one", site.url, "--width", String(site.width), "--name", site.name];
  if (flag("refresh")) args.push("--refresh");
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  const line = (r.stdout ?? "").split("\n").reverse().find((l) => l.startsWith("SCORE:"));
  const score: Score = line ? JSON.parse(line.slice(6)) : { name: site.name, ok: false, error: r.error ? String(r.error.message) : `exit ${r.status}` };
  results.push(score);
  const secs = ((Date.now() - t0) / 1000).toFixed(0).padStart(3);
  console.log(
    score.ok
      ? `height ${String(score.heightRatio).padEnd(6)}  pixels ${(score.pixels! * 100).toFixed(1).padStart(5)}%  boxes-off ${(score.badBoxes! * 100).toFixed(0).padStart(3)}%  unmatched ${(score.unmatched! * 100).toFixed(0).padStart(3)}%   ${secs}s`
      : `FAILED ${score.error}   ${secs}s`,
  );
}

const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
const run = { at: new Date().toISOString(), commit: sha, results };
fs.writeFileSync(path.join(scoresDir, "latest.json"), JSON.stringify(run, null, 1));

// --- compare with the baseline -------------------------------------------------------------
let regressions = 0;
if (fs.existsSync(baselineFile)) {
  const base = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as typeof run;
  const prev = new Map(base.results.map((s) => [s.name, s]));
  console.log(`\nvs baseline ${base.commit} (${base.at.slice(0, 10)}):`);
  for (const s of results) {
    const b = prev.get(s.name);
    if (!b || !b.ok) continue;
    if (!s.ok) {
      console.log(`  WORSE   ${s.name}: failed now (${s.error})`);
      regressions++;
      continue;
    }
    const notes: string[] = [];
    let worse = false;
    const pxd = s.pixels! - b.pixels!;
    if (Math.abs(pxd) >= 0.005) {
      notes.push(`pixels ${(b.pixels! * 100).toFixed(1)}% -> ${(s.pixels! * 100).toFixed(1)}%`);
      if (pxd > 0) worse = true;
    }
    const hd = Math.abs(s.heightRatio! - 1) - Math.abs(b.heightRatio! - 1);
    if (Math.abs(hd) >= 0.005) {
      notes.push(`height ${b.heightRatio} -> ${s.heightRatio}`);
      if (hd > 0) worse = true;
    }
    const bd = s.badBoxes! - b.badBoxes!;
    if (Math.abs(bd) >= 0.02) {
      notes.push(`boxes-off ${(b.badBoxes! * 100).toFixed(0)}% -> ${(s.badBoxes! * 100).toFixed(0)}%`);
      if (bd > 0) worse = true;
    }
    if (notes.length) {
      console.log(`  ${worse ? "WORSE  " : "better "} ${s.name}: ${notes.join(", ")}`);
      if (worse) regressions++;
    }
  }
  if (!regressions) console.log("  no site got worse");
} else {
  console.log("\nno baseline yet: run with --update to record this run as one");
}
if (flag("update")) {
  fs.writeFileSync(baselineFile, JSON.stringify(run, null, 1));
  console.log(`baseline updated (${sha})`);
}
process.exit(regressions ? 1 : 0);
