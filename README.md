# wasm-html-to-image

HTML → 画像変換の単一 Skia-WASM 統合ライブラリ。`satoru` (HTML 描画) と `wasm-image-optimization` (画像変換) を 1 つの Emscripten モジュールに統合し、TypeScript ファサードから利用する。

成果物: `packages/html-to-image/dist/html-to-image.{js,wasm}` (通常版)、`packages/html-to-image/dist/html-to-image-single.js` (SINGLE_FILE 版)。公開パッケージは `wasm-html-to-image` の1つのみ (ローダー同梱)。

## 構成

```text
packages/html-to-image (単一公開パッケージ: core/single/workerd/workers/index/cli/loader/worker-lib-loader)
        │ loadHtmlToImageModule() → HtmlToImageModule 1インスタンス共有
        ▼
packages/html-to-image/dist (単一WASM, EXPORT_NAME=createHtmlToImageModule, MODULARIZE+EXPORT_ES6)
  satoru_render (HTML→PNG/SVG/PDF/WebP) / converter_encode (PNG→JPEG/WebP/AVIF/RAW/ThumbHash)
  converter_encode_svg / converter_encode_pdf (画像→SVG/PDF)
  html_to_image (Bitmap直結: PNG中間をJSに返さない単一呼出し)
```

ワークスペース (`pnpm-workspace.yaml`, `packages/*`):

- `wasm-html-to-image` (`packages/html-to-image`): 唯一の公開パッケージ。TS ファサード + 単一 WASM ローダー (`src/loader.ts`) 同梱。Node/browser 共用、`glueUrl`/`locateFile` 指定可、プロセス内キャッシュあり。単一WASM専用。旧2依存 (`satoru-render` / `wasm-image-optimization`) への依存・フォールバックなし。

形式ごとの経路 (`src/core.ts`, `htmlToImage` に統合。`convertImage` は廃止):

| 入力 | 出力 | 経路 |
|---|---|---|
| HTML (`string`/`string[]`/URL) | 全形式 | 同一インスタンスで資源解決 (`satoru_collect_resources` → 取得 → `satoru_add_resource`) 後に描画。`svg`/`pdf` は satoru 直出力、ラスタは `satoru_render` PNG中間 → encode |
| 画像 (バイト列/`data:image/`) | `png`/`jpeg`/`webp`/`avif`/`raw`/`thumbhash` | 描画スキップ → `converter_encode` 直行 (`width`/`height`は出力リサイズ、`crop`/`fit`適用可) |
| 画像 | `svg` | 描画スキップ → `converter_encode_svg` (PNG data URLの`<image>`一枚で包む) |
| 画像 | `pdf` | 描画スキップ → `converter_encode_pdf` (等倍1ページ、`drawImage`配置) |

入力判定 (`isImageInput`): バイナリはマジックバイト (PNG/JPEG/WebP/GIF/AVIF/BMP)、
文字列は `data:image/` プレフィックス。未知のバイナリはエラー。
戻り値はバイト列 (`Uint8Array`) に統一。`svg` のみ `string`。

経路選択 (単一WASMのみ):

1. HTML入力 → 同一インスタンスで資源解決後に描画 (現行正経路)。
2. 画像入力 → 常に `converter_*` 直行。
3. `html_to_image` 統一bindingは、instance描画bindingを持たない旧ビルド用の
   legacy fallback (資源解決なし)。

注意: `crop`/`fit` は画像入力ではエンコード段、HTML入力では描画オプションとして適用。`quality` (既定85)/`speed` (既定6) はエンコード段のみに効く (`svg`/`pdf` では無視)。

## 公開 API

```ts
// single: ゼロコンフィグ (単一WASM既定接続)。render() に統合済み
import { render, isImageInput } from "wasm-html-to-image/single";
const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" }); // Uint8Array
const svg = await render({ value: "<h1>hi</h1>", width: 800, format: "svg" }); // string
const webp = await render({ value: png, format: "webp", quality: 80 }); // 画像→画像もrender
isImageInput(png); // true

// node: 単一接続を明示構築
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image";
const mod = await loadHtmlToImageModule();
await htmlToImage(mod, { value: "<h1>hi</h1>", width: 800, format: "webp" });
await htmlToImage(mod, { value: png, format: "jpeg", quality: 85 });
```

既定フォント解決: `@font-face` 宣言なしの汎用ファミリ
(sans-serif/serif/monospace/cursive/fantasy/emoji) は `DEFAULT_FONT_MAP`
(satoru既定値そのまま) を `satoru_set_font_map` で適用し、Google Fonts
(Chrome UAでwoff2取得) から取得する。取得方式のためバンドルフォントは
同梱しない。取得バイト列はプロセス内キャッシュ(URLキー)される。
`fontMap`/`userAgent` オプションで上書き可。利用者注入フォールバックは
`fallbackFonts` (バイト列・data: URL・取得URL) で描画前に投入される。

## workerd (Cloudflare Workers)

上流互換の自動切替え: `workerd` 条件では `dist/workerd.js` が解決される
(`.` の `workerd` 条件 + `./workerd` サブパス公開、typesVersions なし)。
SINGLE_FILE 版ではなく通常版 `dist/html-to-image.wasm` を
`WebAssembly.Module` として束ね、`instantiateWasm` を上書きする上流式
(`satoru` / `wasm-image-optimization` の `workerd.ts` を踏襲)。

```ts
// wrangler.toml: [assets] 等で dist/html-to-image.wasm を同梱し、
// Module として import できる構成にすること
import { render } from "wasm-html-to-image/workerd";
const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" });
const webp = await render({ value: png, format: "webp", quality: 80 });
```

並列化が必要な場合は下記 `workers` を使うこと。

Miniflare (ローカル検証・`wrangler dev`) 既定では
`.wasm` が JavaScript としてパースされ
`Cannot find package 'a' imported from .../html-to-image.wasm` で失敗する。
`wrangler.jsonc` に下記ルールを渡すと
`WebAssembly.Module` として束ねられる。

```jsonc
// wrangler.jsonc
{
  "main": "src/index.tsx",
  "rules": [{ "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": false }]
}
```

検証は `wrangler dev` + HTTP スモーク (`scripts/smoke.mjs`、vitest 不使用)。
空きポートで `wrangler dev` を起動し、HTTP 越しに PNG 形状等を assert する。
`@cloudflare/vitest-pool-workers` は vitest 5 系に未対応のため不使用
(対応版が出るまでは本方式を維持)。

- `packages/cloudflare-ogp`: `pnpm --filter cloudflare-ogp test`
  (`GET /?title=Hello` → PNG、`GET /not-found` → 404)。
- `packages/e2e-cloudflare`: `src/smoke-worker.ts`
  (workerd entry 公開用の最小ワーカー) を `wrangler dev` で起動し、
  `/png` (magic+length)・`/svg` (文字列)・`/invalid` (400) を検証。
  実行: `pnpm --filter e2e-cloudflare test`。

## workers (ワーカープール並列化)

上流式 (`satoru` / `wasm-image-optimization` の `workers.ts` /
`child-workers.ts` を踏襲)。モジュールはスレッドを跨げないため、
ワーカー毎に loader で自前ロードする (ワーカー内遅延単一モジュール)。

```ts
import { createHtmlToImageWorker } from "wasm-html-to-image/workers";
const pool = createHtmlToImageWorker({ maxParallel: 4, timeoutMs: 30000 });
const [a, b] = await Promise.all([
  pool.render({ value: "<h1>a</h1>", width: 800, format: "png" }),
  pool.render({ value: jpgBytes, format: "webp", quality: 80 }),
]);
console.log(pool.getStats()); // { workerCount, activeJobs, queuedJobs, ... }
pool.reset(); // ハング時の再生成+統計リセット
await pool.waitAll();
pool.close();
```

- プール化するアクションは統合 `render` 1本 (HTML/画像両対応)。
- `./workers` export条件: `workerd` → 直結実行フォールバック
  (`workers-dummy.js`、プール化せず `workerd.js` の `render` を呼ぶ)、
  `node`/`browser` → `workers.js`。typesVersions なし。
- 相違点: tsc-onlyビルドのため事前バンドルの `web-workers.js` は作らず、
  常に `child-workers.js` を参照 (browser利用はバンドラか `worker` 指定)。
  `worker-lib` の公開ESMは拡張子なしimportで素のNodeでは壊れる
  (2.2.0/2.2.1共通の上流不具合) ため、`worker-lib-loader.ts` が
  ESM試行→CJSフォールバック (`createRequire`) で吸収する。

検証: `node scripts/parallel-smoke.mjs` (12件混合、逐次845ms→並列x4で328ms、全件成功)。

## CLI

```bash
npx tsx packages/html-to-image/src/cli.ts input.html -o out.webp -w 800 -f webp -q 85
npx tsx packages/html-to-image/src/cli.ts photo.jpg -o out.webp -f webp   # 画像入力も可
npx tsx packages/html-to-image/src/cli.ts https://example.com -o out.png -f png
pnpm --filter wasm-html-to-image example:cli  # --help表示
```

オプション: `<input (HTMLパス|URL)> -o/--output -w/--width(既定800) -h/--height(省略時auto) -f/--format(svg/png/pdf/jpeg/webp/avif/raw/thumbhash, 既定png) -q/--quality(既定85)`

## ビルド

前提: EMSDK (`EMSDK`, `EMSDK_VERSION` 任意), `VCPKG_ROOT`, Git `patch.exe` (Windows では Git 同梱版を自動優先), Ninja (あれば使用、なければ make)。

```bash
pnpm install
npx tsx scripts/build-wasm.ts configure [--force]
npx tsx scripts/build-wasm.ts build
pnpm --filter wasm-html-to-image build       # tsc -b (ファサード+ローダー型)
node scripts/smoke-test.mjs [test-image-path]
```

## テスト構成 (2層)

- 単体テスト (`packages/html-to-image/tests/`, vitest): 実WASMを使わず
  モジュールスタブで高速に検証。`isImageInput` 判定 (6形式マジック/
  `data:image/`/HTML/未知形式throw) + `htmlToImage` 経路振分け
  (unified/2-call/画像直行/svg-pdf分岐の呼出し先assert) + エラー系
   (未登録binding throw等)。実行: `pnpm --filter wasm-html-to-image test`
   (`vitest run`, 49件)。
- 実機テスト (`scripts/smoke-test.mjs` a〜h + `scripts/parallel-smoke.mjs`):
  実WASM成果物に対する検証。重い実WASMを使う検証は単体テストと重複させず
  こちらに集約する。

CMake オプション (`CMakeLists.txt`):

| オプション | 既定 | 意味 |
|---|---|---|
| `WASM_EXPORT_NAME` | `createHtmlToImageModule` | JS ファクトリ名 (`-sEXPORT_NAME`) |
| `WASM_AVIF_BACKEND` | `DAV1D` | `DAV1D` 既定(デコードのみ)、`AOM` でencode/decode有効化 (`-DWASM_AVIF_BACKEND=AOM`、現ビルドはAOM適用済み) |
| `WASM_ENABLE_TEXT_SHAPING` | `ON` | freetype+harfbuzz+skshaper |
| `WASM_ENABLE_PDF` | `ON` | Skia PDF (`src/pdf`+`pathops`)、OFF でも pathops は残る |
| `WASM_ENABLE_SKSL` | `OFF` | SkSL 系 (`SkRuntimeBlender` 等) を除外して軽量化 |

vcpkg (`vcpkg.json`): freetype/png/jpeg-turbo/webp/dav1d/zlib/gumbo/bzip2/brotli/expat/ctre/utf8proc/libunibreak/qpdf/harfbuzz。libavif は FetchContent (`v1.1.1`)、Skia は FetchContent `main` 追従。C++ 側 LSP 設定: `.vscode/c_cpp_properties.json` (Emscripten + `build/compile_commands.json`)。

C++ 構成の詳細は「由来・移植方針」を参照。C++ 側 LSP 設定: `.vscode/c_cpp_properties.json` (Emscripten + `build/compile_commands.json`)。

## 由来・移植方針

`satoru` (HTML描画) と `wasm-image-optimization` (画像変換) の両リポは
読取のみ。変更・コピー自動化なし。移植済みのため `src/cpp/common/README.md` /
`src/cpp/core/TODO.md` の計画メモは本節に集約し、原文はリンクのみ残す。

| 領域 | 正本 | 備考 |
|---|---|---|
| Skia描画ユーティリティ | satoru版 `utils/skia_utils` | image-opt版はサブセットのため不採用 |
| デコーダ | converter `load_image` (全フレーム+EXIF補正+format/animated) + satoru `decode_svg` 統合 | `common/image_decoder` |
| SVGパッチ | converter `patch_svg_data` 完全版 | satoru版はno-opのため不採用 |
| エンコード分岐 | image-opt `encode()` switchをインスタンス非依存のdispatcher化 | `common/skia_encode` (`encode_single_bitmap`/`encode_frames`)。satoru各rendererの使い方はprimitiveの特殊化と等価 |
| ThumbHash | converter `utils/thumbhash` | `common/thumbhash` |
| PDFマージャ | satoru側 | |
| 実行コンテキスト | 分離維持 (`SatoruContext`/`ImageConverterContext`) | 描画状態と変換状態は寿命・所有権が異なるため統合しない |
| LRUキャッシュ | 両リポ同一ロジックを共通化1本 | namespace差のみ |
| core一式・renderers・api | satoru側を改名移植 (`satoru_api_*`) + converter側 (`converter_api_*`) | mangle回避のprefix分離は `src/cpp/main.cpp` 参照 |

`api/unified_api`: `SkBitmap` → `render_bitmap_to_encoded` の薄ラッパ
(`encode_single_bitmap` 経由、PNG中間なし)。所有権は呼び出し側保持。

## 検証実績

`scripts/smoke-test.mjs` (`packages/html-to-image/dist/html-to-image-single.js` + TSファサード対象): a〜h いずれも PASS。

- a (converter 往復): `converter_load_image` → `converter_encode(WebP)` マジック `RIFF` 確認 → `converter_crop(8x8)` → `converter_encode(PNG)` マジック `89PNG` 確認。
- b (satoru 描画): `satoru_render("<h1>hi</h1>", 800, 600, PNG)` が PNG バイト列 (1970B) を返却。
- c (統合): `html_to_image(...)` がクラッシュなく応答。
- d (ファサード画像入力): `render({ value: jpgBytes, format: "webp" })` が `RIFF` を返却。
- e (ファサードHTML入力): `render({ value: html, format: "png" })` が `89PNG` を返却。
- f (ファサード画像入力): `render({ value: jpgBytes, format: "svg" })` が `<svg>`+`<image>` 文字列を返却。
- g (ファサード画像入力): `render({ value: jpgBytes, format: "pdf" })` が `%PDF` を返却。

## 既知制限

- 未登録スタブ (`src/cpp/main.cpp` で明示的に除外): `load_image_pixels` (C APIなし) / `init_document` / `layout_document` / `render_from_state` / `merge_pdfs` / `get_font_diagnostics` 系。登録済み resource 系は scan_css / load_image / set_font_map / collect_resources / get_pending_resources / add_resource / load_font / load_fallback_font / get_last_*_size / collect-profile 系。TS発見ループが外部フォント/画像を解決してから同一インスタンスで描画する。
- 画像→SVG/PDFは dispatcher (`encode_frames`) を経由せず、専用 binding (`converter_encode_svg` / `converter_encode_pdf`) で対応済み。dispatcher自体の SVG/PDF 分岐は未対応 (null) のまま残す。
- アニメーション画像入力は `animation: true` 指定時のみ全フレーム WebP encode する (既定は先頭フレームのみ)。GIF は Skia (wuffs) デコード、アニメーション WebP 入力も全フレーム保持される。
- TS 側は単一WASM専用。`satoru_render` / `converter_encode` / `html_to_image` の有無は実行時に `typeof` 判定し、未登録時は単一WASM必須エラーを投げる。
- Skia は `main` 追従 (FetchContent shallow)。上流変更でビルドが壊れた場合は `builtin-baseline` (`vcpkg.json`) と Skia `GIT_TAG` の固定を検討すること。
