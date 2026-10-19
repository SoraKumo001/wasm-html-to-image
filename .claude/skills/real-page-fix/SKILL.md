---
name: real-page-fix
description: Find and fix layout/render bugs in the wasm-html-to-image C++ engine (litehtml + Skia) by rendering real web pages and comparing them with Chromium. Use when asked to test real sites, when a page renders too tall/short/blank/slow, or when a CSS feature is suspected to be unsupported.
---

# Real-page bug hunting and fixing

Chromium is the reference. Render a real URL with the wasm engine and with Chromium, find where they diverge, shrink the divergence to a minimal HTML/CSS case, fix the engine, lock it in with a regression test.

Run scripts from `packages/visual-test`; keep scratch scripts in `packages/visual-test/temp/` (git-ignored). The engine has no JS, so **always load the Chromium side with `javaScriptEnabled: false`**.

## 1. Measure

- Our render: `render({ url, width: 1000, format: "png" })` from `wasm-html-to-image/single` (use `value:` for raw HTML; `css:` injects extra CSS). Do not pass `baseUrl: url` for URL inputs: it pins resource resolution to the request host and defeats post-redirect base following (only pass `baseUrl` to intentionally pin). Compare heights first: a page 2x+ taller than Chromium has a layout bug, shorter/blank has a paint or fetch bug.
- Chromium height: `page.evaluate("document.documentElement.scrollHeight")` (nojs context, viewport 1000 wide).
- Look at pictures, not only numbers: crop our PNG at several y offsets (composite alpha over white). Downscaled contact sheets (6000px slices, 1/4 scale) show where a tall page goes wrong.
- Run each URL in its own process with a timeout (`timeout 150 node ...`); a hang must not kill the batch.

## 2. Sanity-check the environment before blaming the engine

- Fetch the page's `<link rel=stylesheet>` URLs yourself. If they return 404/HTML (stale deploy, bot block), the page is simply unstyled; this is not an engine bug (NHK did this).
- Chromium full-page screenshots repeat content beyond ~16384px. Do not compare pixels past that; compare DOM geometry (`getBoundingClientRect`) instead.
- Different fonts change line heights a little (sans-serif maps to Noto Sans JP here). Ignore differences under ~10%.

## 3. Shrink to a minimal case

Extract the offending subtree from Chromium: the element's `outerHTML` plus every stylesheet rule that matches it or a descendant (walk `document.styleSheets`, keep `@media` wrappers, test with `el.matches`). Render that alone with `value:`. Then:

- Height differs? Delta-debug: remove top-level CSS rules / HTML children while the symptom persists (each trial in a child process with a timeout). Rules inside a single `@layer` must be split from the inside.
- Still fine in isolation? The cause is context: widen the extraction (more ancestors), add the `<html class>` Chromium had (e.g. `vector-feature-limited-width-clientpref-1`), or compare with all rules vs matched rules.
- Probe one property at a time with tiny HTML and compare to Chromium numbers (`getBoundingClientRect`) rather than guessing.

## 4. Fix

- Engine code: `src/cpp/libs/litehtml/src/*` (layout/CSS), `src/cpp/core/*` (Satoru layer: fonts, SVG, UA CSS in `core/master_css.h`).
- Rebuild: `pnpm wasm:build` (minutes; run in background if a reconfigure is needed) then `pnpm --filter wasm-html-to-image build`. Debug with `emscripten_log(EM_LOG_CONSOLE, ...)` from `<emscripten.h>`; remove it before committing.
- Specificity/cascade bugs are common: UA rules should use `:where()`, presentational hints specificity `(0,0,0,1)`.
- Percent heights against auto-height containers behave as auto; `float`/`absolute` blockify `inline-flex`/`inline-grid`; `overflow` takes 1-2 values.
- Pathological nesting: layout work is bounded by a per-pass measure budget (`document::k_measure_budget`); deep flex/table trees are otherwise exponential.

## 5. Lock in and commit

- Add a probe test to `packages/visual-test/test/regression.test.ts` (helper `renderPng(body, w, h)` returns `{img, at(x,y)}`; or assert `render(...).height`). Make it fail without the fix.
- Run `pnpm test` (unit) and `pnpm test:visual` (all must pass), delete stray `packages/visual-test/[object Object]-*.png`, commit one fix per commit, Conventional-Commit style, with the repo's co-author trailer.

## Pitfalls seen

- Writing C++ with Python: open with `encoding='utf-8'`, keep CRLF files CRLF (`newline=''`), and write `\n` inside C string literals as `r'...\n'`.
- `pnpm test:visual` imports the built package; rebuild before running it after C++ changes.
- `render({ value: url })` renders the URL string as HTML; use `url`/`baseUrl`.
- SVG text needs the font manager from `container->get_context().fontManager`; CJK glyphs in SVG `<text>` are still partial.
