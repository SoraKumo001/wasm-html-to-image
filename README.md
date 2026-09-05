# wasm-html-to-image

HTML → 画像変換の単一 Skia-WASM 統合ライブラリ。`satoru` (HTML 描画) と `wasm-image-optimization` (画像変換) を 1 つの Emscripten モジュールに統合し、TypeScript ファサードから利用する。

成果物: `packages/html-to-image/dist/html-to-image.{js,wasm}` (通常版)、`packages/html-to-image/dist/html-to-image-single.js` (SINGLE_FILE 版)。公開パッケージは `wasm-html-to-image` の1つのみ (ローダー同梱)。

## 構成

```text
packages/html-to-image (単一公開パッケージ: core/single/index/cli/loader)
        │ loadHtmlToImageModule() → HtmlToImageModule 1インスタンス共有
        ▼
packages/html-to-image/dist (単一WASM, EXPORT_NAME=createHtmlToImageModule, MODULARIZE+EXPORT_ES6)
  satoru_render (HTML→PNG/SVG/PDF/WebP) / converter_encode (PNG→JPEG/WebP/AVIF/RAW/ThumbHash)
  html_to_image (Bitmap直結: PNG中間をJSに返さない単一呼出し)
```

ワークスペース (`pnpm-workspace.yaml`, `packages/*`):

- `wasm-html-to-image` (`packages/html-to-image`): 唯一の公開パッケージ。TS ファサード + 単一 WASM ローダー (`src/loader.ts`) 同梱。Node/browser 共用、`glueUrl`/`locateFile` 指定可、プロセス内キャッシュあり。単一WASM専用。旧2依存 (`satoru-render` / `wasm-image-optimization`) への依存・フォールバックなし。

形式ごとの経路 (`src/core.ts`):

| 出力 | 経路 |
|---|---|
| `svg` / `pdf` | satoru 直出力 (1 段) |
| `png` / `jpeg` / `webp` / `avif` / `raw` / `thumbhash` | satoru PNG 中間 → encode (2 段) または `html_to_image` 直結 (1 呼出し) |

経路選択 (`htmlToImage`, 単一WASMのみ):

1. `html_to_image` バインディングあり → Bitmap 直結単一呼出し (`render_bitmap_to_encoded`, JS に PNG 中間を返さない)。
2. なし → 単一モジュール 2 呼出し (`satoru_render` → `converter_encode`、同一モジュール共有)。いずれのバインディングも未登録のビルドではエラー (単一WASM必須、旧2依存フォールバックなし)。

注意: `resize`/`crop`/`fit` は描画段のみで適用しエンコード段では再適用しない。`quality`/`speed` はエンコード段のみに効く (`svg`/`pdf` では無視)。

## 公開 API

```ts
// single: ゼロコンフィグ (単一WASM既定接続)
import { render, convertImage } from "wasm-html-to-image/single";
const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" }); // Uint8Array
const svg = await render({ value: "<h1>hi</h1>", width: 800, format: "svg" }); // string
await convertImage({ image: png, format: "webp", quality: 80 }); // { data, ... }

// node: 単一接続を明示構築
import { loadHtmlToImageModule, htmlToImage, convertImage } from "wasm-html-to-image";
const mod = await loadHtmlToImageModule();
await htmlToImage(mod, { value: "<h1>hi</h1>", width: 800, format: "webp" });
await convertImage(mod, { image: png, format: "jpeg", quality: 85 });
```

`convertImage` (single) は画像→画像変換のみ (HTML 描画なし)。

## workerd (Cloudflare Workers)

上流互換の自動切替え: `workerd` 条件では `dist/workerd.js` が解決される
(`.` の `workerd` 条件 + `./workerd` サブパス公開、typesVersions なし)。
SINGLE_FILE 版ではなく通常版 `dist/html-to-image.wasm` を
`WebAssembly.Module` として束ね、`instantiateWasm` を上書きする上流式
(`satoru` / `wasm-image-optimization` の `workerd.ts` を踏襲)。

```ts
// wrangler.toml: [assets] 等で dist/html-to-image.wasm を同梱し、
// Module として import できる構成にすること
import { render, convertImage } from "wasm-html-to-image/workerd";
const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" });
await convertImage({ image: png, format: "webp", quality: 80 });
```

残課題: `workers` スレッドプール (`worker-lib`) は今回作らない。
上流は `./workers` + `workers-dummy.js` で node/browser/workerd を切替えているが、
本リポは単一WASM直結のため要否検討から着手すること。

## CLI

```bash
npx tsx packages/html-to-image/src/cli.ts input.html -o out.webp -w 800 -f webp -q 85
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

CMake オプション (`CMakeLists.txt`):

| オプション | 既定 | 意味 |
|---|---|---|
| `WASM_EXPORT_NAME` | `createHtmlToImageModule` | JS ファクトリ名 (`-sEXPORT_NAME`) |
| `WASM_AVIF_BACKEND` | `DAV1D` | `DAV1D` 既定、`AOM` は OPT-IN (`-DWASM_AVIF_BACKEND=AOM`) |
| `WASM_ENABLE_TEXT_SHAPING` | `ON` | freetype+harfbuzz+skshaper |
| `WASM_ENABLE_PDF` | `ON` | Skia PDF (`src/pdf`+`pathops`)、OFF でも pathops は残る |
| `WASM_ENABLE_SKSL` | `OFF` | SkSL 系 (`SkRuntimeBlender` 等) を除外して軽量化 |

vcpkg (`vcpkg.json`): freetype/png/jpeg-turbo/webp/dav1d/zlib/gumbo/bzip2/brotli/expat/ctre/utf8proc/libunibreak/qpdf/harfbuzz。libavif は FetchContent (`v1.1.1`)、Skia は FetchContent `main` 追従。C++ 側 LSP 設定: `.vscode/c_cpp_properties.json` (Emscripten + `build/compile_commands.json`)。

C++ 構成の詳細は `src/cpp/common/README.md` (重複排除・`common/skia_encode` 方針)、残作業は `src/cpp/core/TODO.md` を参照。

## 検証実績

`scripts/smoke-test.mjs` (`packages/html-to-image/dist/html-to-image-single.js` 対象): a/b/c いずれも PASS。

- a (converter 往復): `converter_load_image` → `converter_encode(WebP)` マジック `RIFF` 確認 → `converter_crop(8x8)` → `converter_encode(PNG)` マジック `89PNG` 確認。
- b (satoru 描画): `satoru_render("<h1>hi</h1>", 800, 600, PNG)` が PNG バイト列 (1970B) を返却。
- c (統合): `html_to_image(...)` がクラッシュなく応答。

## 既知制限

- 未登録スタブ (`src/cpp/main.cpp` で明示的に除外): `collect_resources` / `add_resource` / `load_font` / `load_fallback_font` / `init_document` / `layout_document` / `render_from_state` / `merge_pdfs` / `get_pending_resources` / `get_font_diagnostics` 系。C++ 実体が TODO スタブのためバインディング未公開。登録済み resource 系は `scan_css` / `load_image` / `set_font_map` / `get_last_*_size` / collect-profile 系のみ。
- TS 側は単一WASM専用。`satoru_render` / `converter_encode` / `html_to_image` の有無は実行時に `typeof` 判定し、未登録時は単一WASM必須エラーを投げる。
- Skia は `main` 追従 (FetchContent shallow)。上流変更でビルドが壊れた場合は `builtin-baseline` (`vcpkg.json`) と Skia `GIT_TAG` の固定を検討すること。
