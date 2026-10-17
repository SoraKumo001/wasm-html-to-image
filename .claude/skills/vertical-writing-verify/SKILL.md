---
name: vertical-writing-verify
description: Verify and fix vertical writing (writing-mode vertical-rl/lr) in the wasm-html-to-image C++ engine by comparing against Chromium. Use when a vertical-writing layout/render bug is reported, when changing litehtml layout code that could affect vertical text, or when updating the vertical regression baselines.
---

# Vertical writing: verify against Chromium and fix

Chromium is the reference. Every fix is checked by rendering the same HTML with the wasm engine and with Chromium, then comparing pixels. Known gaps live in `packages/visual-test/vertical/FINDINGS.md` ("未対応・既知の制限"); read it first so you do not re-investigate them.

## Workflow

Run from `packages/visual-test`. Set `CHROMIUM_PATH` to a Chromium executable if the default (ms-playwright 1248) is absent.

```bash
npx tsx vertical/gen-cases.ts            # regenerate cases/*.html from the object map in gen-cases.ts
npx tsx vertical/compare.ts <substr>     # engine vs Chromium; writes vertical/out/<case>.png (left Chromium, right engine), prints fill/outline %
npx tsx vertical/formats.ts <substr>     # PNG vs SVG vs PDF consistency
npx tsx vertical/gen-reference.ts        # Chromium references into vertical/reference/ (gitignored)
npx vitest run test/vertical.test.ts     # regression test against reference + test/data/vertical-baselines.json
```

1. Add or edit a case in `vertical/gen-cases.ts`, regenerate, and run `compare.ts` on it. Look at `out/<case>.png`; the metrics alone miss placement errors.
2. Fix the engine, rebuild (below), re-run `compare.ts`.
3. Generate references (`gen-reference.ts`), then record baselines:
   `UPDATE_SNAPSHOTS=1 npx cross-env CHROMIUM_PATH=... vitest run test/vertical.test.ts`.
4. Run the whole `pnpm --filter visual-test test` once: the 26 horizontal assets must stay within about 0.3% of their baselines.
5. Update `FINDINGS.md` (move the item to 修正済み, adjust 既知の制限), then commit one fix per commit.

Tolerance in `test/vertical.test.ts`: fill/outline within 1.5 percentage points of the baseline, height within 2px.

## Build

```bash
pnpm wasm:build                           # emscripten + ninja, ccache
pnpm --filter wasm-html-to-image build    # bundles dist/html-to-image.{js,wasm}
```

If every PNG test fails with `WebAssembly.CompileError`, `dist/html-to-image.wasm` is truncated: delete `dist/html-to-image.js` and `.wasm` and run both commands again.

## Engine map

- Logical geometry: `src/cpp/core/logical_geometry.h` (`satoru::WritingModeContext`). `containing_block_context::inline_size()/block_size()` pick the physical axis. In vertical writing, "inline size" is the height. Using `width` where an inline size is meant is the usual cause of vertical-only bugs.
- Layout lives in `src/cpp/libs/litehtml/src/`:
  - `render_item.cpp`: `measure`, `place`, containing-block setup
  - `render_block_context.cpp`
  - `render_inline_context.cpp`: `new_box`, `place_inline`, `apply_vertical_align`
  - `line_box.cpp`: justify, `finish`
  - `render_table.cpp` and `table.cpp`: `layout_table_vertical`, `table_grid` axis transposition
  - `render_grid.cpp`: `vert` branches
  - `render_flex.cpp`
  - `document.cpp`: body writing-mode propagation, right-edge anchoring for vertical-rl
  - `html_tag.cpp`: list markers, split-inline borders
- CSS properties: `css_properties.cpp` (logical size props map to physical per writing mode; `sideways-*` folds into vertical plus `text-orientation: sideways`), `style.cpp`, `string_id.h`.
- Text: `src/cpp/core/text/` (`text_layout.cpp` letter-spacing, `text_renderer.cpp` text-combine-upright draw path). Font metrics (`super_shift`/`sub_shift`) are set in `src/cpp/core/container_skia.cpp`.
- UA CSS: `src/cpp/core/master_css.h`. Ruby is implemented purely here (`ruby` as inline-flex column-reverse, `rt` block 50%, `rp` hidden). Prefer UA CSS when a feature can be expressed as styles.

## Pitfalls

- `render_item::measure` must return the inline-axis length on a cache hit (height in vertical writing), not the physical width.
- A vertical box with a definite height must not pass shrink-to-fit to its children (`calculate_containing_block_context`).
- A vertical box inside a horizontal parent (or the reverse) is a BFC; floats must not leak out of it.
- List-marker glyphs must be measured at layout time (`measure_list_marker`) or they render as tofu.
- Do not write Japanese literals through Python escape strings; they become mojibake. Write the real characters.
- Remove debug output before committing: `grep -rn "DBG\|fprintf(stderr" src/cpp`.
- Chromium's `text-spacing-trim` has no equivalent here, so small line-end differences (cases 03, 17) are expected, not bugs.
