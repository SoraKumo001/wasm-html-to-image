/**
 * Shrink a failing fuzz case to a minimal HTML that still differs from Chromium the same way.
 *
 *   pnpm real:fuzz-reduce <mode> <seed> [--width 600] [--tol 1.5]
 *   pnpm real:fuzz-reduce --file <case.html>
 *
 * Greedy delta debugging over the DOM: remove an element, replace it by its children, or drop one
 * style declaration; keep a step when the engine still disagrees with Chromium in the same
 * property and direction (e.g. "width too small") as the first divergence of the original case.
 * Prints the reduced HTML and the remaining divergence.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { CACHE_DIR, Store, chromiumPath, compareBoxes, ensureDir, launchChromium, measureChrome, measureOurs, type BoxDelta } from "./lib.mts";
import { generate } from "./fuzz.mts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

type Prop = "dx" | "dy" | "dw" | "dh";
interface Signature {
  prop: Prop;
  sign: number;
}

/** The property and direction of the first (shallowest non-root) bad box. */
function signatureOf(bad: BoxDelta[], tol: number): Signature | undefined {
  const pick = bad.find((b) => b.p.split(".").length > 2) ?? bad[0];
  if (!pick) return undefined;
  for (const prop of ["dw", "dh", "dx", "dy"] as Prop[]) {
    if (Math.abs(pick[prop]) > tol) return { prop, sign: Math.sign(pick[prop]) };
  }
  return undefined;
}

const OPS_SOURCE = `(args) => {
  const { html, kind, index, decl } = args;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const els = Array.from(doc.body.querySelectorAll("*"));
  if (kind === "count") return JSON.stringify(els.map((e) => (e.getAttribute("style") || "").split(";").filter((s) => s.trim()).length));
  const el = els[index];
  if (!el) return null;
  if (kind === "remove") el.remove();
  else if (kind === "unwrap") el.replaceWith(...Array.from(el.childNodes));
  else if (kind === "decl") {
    const parts = (el.getAttribute("style") || "").split(";").filter((s) => s.trim());
    parts.splice(decl, 1);
    if (parts.length) el.setAttribute("style", parts.join(";")); else el.removeAttribute("style");
  } else if (kind === "head") {
    const st = doc.head.querySelector("style");
    if (st) st.remove();
  }
  return "<!doctype html>" + doc.documentElement.outerHTML;
}`;

async function main() {
  const width = Number(arg("width", "600"));
  const tol = Number(arg("tol", "1.5"));
  const file = arg("file", "");
  let html: string;
  if (file) html = fs.readFileSync(file, "utf8");
  else {
    const [mode, seed] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    html = generate(Number(seed), mode);
  }

  const outDir = path.join(CACHE_DIR, "fuzz");
  const dir = path.join(outDir, "store-reduce");
  ensureDir(dir);
  const store = new Store(dir, { url: "http://fuzz.test/", finalUrl: "http://fuzz.test/", capturedAt: "", entries: {} });
  const chrome = await launchChromium();
  const helper = await chromium.launch({ executablePath: chromiumPath() });
  const helperPage: Page = await (await helper.newContext()).newPage();
  const op = (args: object) => helperPage.evaluate(`(${OPS_SOURCE})(${JSON.stringify(args)})`) as Promise<string | null>;

  const run = async (h: string) => {
    const ours = await measureOurs(store, { html: h }, width);
    const ref = await measureChrome(chrome, store, { html: h }, width, { screenshot: false });
    return compareBoxes(ours.boxes, ref.boxes, tol);
  };

  try {
    const first = await run(html);
    const sig = signatureOf(first.bad, tol);
    if (!sig) {
      console.log("case already matches Chromium (nothing to reduce)");
      return;
    }
    console.log(`reducing: first divergence ${sig.prop} ${sig.sign > 0 ? "+" : "-"}, ${first.bad.length} bad boxes`);

    const stillFails = async (h: string): Promise<boolean> => {
      try {
        const c = await run(h);
        const s = signatureOf(c.bad, tol);
        return !!s && s.prop === sig.prop && s.sign === sig.sign;
      } catch {
        return false;
      }
    };

    let progress = true;
    let rounds = 0;
    while (progress && rounds++ < 40) {
      progress = false;
      const counts = JSON.parse((await op({ html, kind: "count" })) as string) as number[];
      // later elements first: removing deep leaves keeps earlier indices valid
      for (let i = counts.length - 1; i >= 0; i--) {
        for (const kind of ["remove", "unwrap"] as const) {
          const cand = await op({ html, kind, index: i });
          if (cand && cand !== html && (await stillFails(cand))) {
            html = cand;
            progress = true;
            break;
          }
        }
        if (progress && (await op({ html, kind: "count" })) !== JSON.stringify(counts)) break;
      }
      if (progress) continue;
      const counts2 = JSON.parse((await op({ html, kind: "count" })) as string) as number[];
      // (dropping a declaration keeps the element count, and going from the last declaration of each
      // element backwards keeps the earlier indices valid, so one pass can apply several drops)
      for (let i = 0; i < counts2.length; i++) {
        for (let d = counts2[i] - 1; d >= 0; d--) {
          const cand = await op({ html, kind: "decl", index: i, decl: d });
          if (cand && cand !== html && (await stillFails(cand))) {
            html = cand;
            progress = true;
          }
        }
      }
    }
    const final = await run(html);
    const e = final.bad.find((b) => b.p.split(".").length > 2) ?? final.bad[0];
    const body = html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
    console.log(`\nreduced HTML (body):\n${body}\n`);
    console.log(`remaining divergence: ${e.p} <${e.t}> dx=${e.dx} dy=${e.dy} dw=${e.dw} dh=${e.dh}  (${final.bad.length} bad boxes)`);
    fs.writeFileSync(path.join(outDir, `reduced-${Date.now()}.html`), html);
  } finally {
    await chrome.close();
    await helper.close();
  }
}

await main();
