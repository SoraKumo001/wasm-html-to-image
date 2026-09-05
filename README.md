# wasm-html-to-image (Phase 1: 統合SDKの足場)

HTML → 画像変換の統合SDK。2つのWASMエンジンをTypeScript層でオーケストレーションする。

## Phase 1 構成図

```text
                    ┌─────────────────────────────┐
 input.html / URL   │     wasm-html-to-image      │
        │           │  packages/html-to-image     │
        ▼           │                             │
 ┌────────────┐     │  src/core.ts                │
 │ CLI (cli)  │────▶│   htmlToImage()             │
 │ commander  │     │   convertImage()            │
 └────────────┘     │        │          │         │
        │           │        ▼          ▼         │
        │           │  ┌──────────┐ ┌──────────┐  │
        │           │  │ satoru-  │ │ wasm-    │  │
        └──────────▶│  │ render   │ │ image-   │  │
  src/single.ts     │  │ (HTML→   │ │ optimiza-│  │
  (embedded WASM    │  │ SVG/PNG/ │ │ tion     │  │
   既定インスタンス) │  │ PDF/WebP)│ │ (PNG→    │  │
                    │  └────┬─────┘ │ JPEG/    │  │
                    │       │ PNG   │ WebP/    │  │
                    │       │ 中間  │ AVIF/    │  │
                    │       └──────▶│ RAW/TH)  │  │
                    │               └──────────┘  │
                    └─────────────────────────────┘
```

### 形式ごとの経路

| 出力形式 | 経路 |
|---|---|
| `svg` / `pdf` | satoru直出力 (1段) |
| `png` / `jpeg` / `webp` / `avif` / `raw` / `thumbhash` | satoru PNG中間 → `optimizeImage` エンコード (2段) |

※ `raw` / `thumbhash` は画像バイナリではなく生ピクセル/ハッシュバイト列を返す
(`wasm-image-optimization` の仕様通り)。

### エントリ

| エントリ | 用途 |
|---|---|
| `wasm-html-to-image` / `./index` | Node用: `core.ts` 再export + `createDeps()` (利用者が `Satoru` / `ImageConverter` を注入) |
| `./single` | embedded-WASM用: `Satoru.create()` / `ImageConverter.create()` の既定インスタンスで `render()` / `convertImage()` |
| `wasm-html-to-image` (bin) | CLI |

## 使い方

```bash
# 依存導入 + ビルド (Phase 2 以降に実行)
pnpm install
pnpm build

# CLI 動作確認 (ビルド不要, tsx で直接実行)
pnpm example:cli
npx tsx packages/html-to-image/src/cli.ts input.html -o out.webp -w 800 -f webp -q 85
```

```ts
// single (簡易)
import { render } from "wasm-html-to-image/single";
const webp = await render({ value: "<h1>hi</h1>", width: 800, format: "webp" });
const svg = await render({ value: "<h1>hi</h1>", width: 800, format: "svg" }); // string

// node (注入)
import { Satoru } from "satoru-render/index";
import { ImageConverter } from "wasm-image-optimization";
import { createDeps, htmlToImage } from "wasm-html-to-image";
```

CLI オプション: `<input> -o -w -h -f -q`

## Phase 2 方針 (単一WASM化)

- C++基盤の方針は `src/cpp/common/README.md` を正とする
  (重複排除・`common/skia_encode` 切出し・コンテキスト分離維持)。
- ビルド基盤: `CMakeLists.txt` / `vcpkg.json` / `triplets/` / `scripts/build-wasm.ts`、
  統合型: `src/cpp/bridge/bridge_types.h`、単一エントリ: `src/cpp/main.cpp`。

- [ ] `pnpm install` + `tsc -b` で型解決を確認 (`satoru-render@1.0.15` / `wasm-image-optimization@2.0.10` はバージョン参照で仮置き)
- [ ] `example:cli` および実HTMLでの全形式マトリクス確認 (svg/png/pdf/jpeg/webp/avif/raw/thumbhash)
- [ ] `dist` バンドル方針の決定 (上流は `tsc -b && rolldown -c`; Phase 1 の `build` は `tsc -b` のみ)
- [ ] `workerd` / `workers` エントリの要否検討 (上流両リポにあるが Phase 1 では未作成)
- [ ] JSDOM ハイドレーション (`satoru` CLI の `--no-jsdom` 相当) の要否検討
- [ ] `diagnostics` / `limits` / `quality` 既定値の調整とテスト追加
- [ ] `raw` / `thumbhash` 出力の拡張子・取り扱い整理

## 切替方針: 単一WASM接続 (primary) + 2依存フォールバック (kept)

- TSファサードの既定経路は **単一WASM接続** (`packages/wasm` の
  `loadHtmlToImageModule()` → `HtmlToImageModule` 1インスタンス共有)。
  `./single` はこの経路のみを使う。
- 経路選択 (`core.ts` `htmlToImageSingle`):
  1. `html_to_image` バインディング有り → **Bitmap直結単一呼出し**
     (PNG中間をJSに返さない。C++ `render_bitmap_to_encoded` のJS公開待ち);
  2. 無し → **単一モジュール2呼出し** (`satoru_render` → `converter_encode`,
     `satoru_*` / `converter_*` 値ラッパーのC++登録待ち);
  3. 上記バインディング未登録の現行ビルドでは `./index` の `createDeps()`
     による **2依存フォールバック** (`satoru-render` +
     `wasm-image-optimization`, `optionalDependencies`) を使用。
- 2依存版は **フォールバックとして残す** (削除しない)。
  C++側 (`CMakeLists` / `build` / `src/cpp`) には触らない。

## 制約事項: バイナリ2本併用 (フォールバック経路のみ)

- 本SDKは Phase 1 では **2つのWASMバイナリを併用** する
  (`satoru.wasm` + `wasm-image-optimization.wasm`)。C++/CMake/vcpkg には触らない。
- 2段経路では **PNG中間バッファのコピーが1回発生** する (大判出力時のメモリに注意)。
- `resize` / `crop` / `fit` は **satoru描画段でのみ適用** し、エンコード段では再適用しない
  (二重リサイズ防止のため `width` / `height` / `crop` / `fit` を渡さない設計)。
- `quality` / `speed` はエンコード段のみに効く (`svg` / `pdf` 直出力時は無視される)。
- 両エンジンの `logLevel` / `onLog` 連携は未実装 (必要になれば `deps` 経由で個別設定)。
