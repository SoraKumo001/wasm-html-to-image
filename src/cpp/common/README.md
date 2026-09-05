# common/ 重複排除方針 (Phase2移植時の正本表)

実装コピーはまだしない。本ディレクトリは方針メモのみ。移植時に下表の「採用」側を正本として持ち込む。

| 領域 | satoru側 | image-opt側 | 方針 |
|---|---|---|---|
| Skia描画ユーティリティ (`utils/skia_utils.cpp`) | 採用 | 不採用 (類似重複) | satoru版を正本とする |
| LRUキャッシュ (`lru_cache`系) | — | — | どちらか一方に共通化 (移植時に実物を突き合わせて決定) |
| SVGパッチ (`svg_patch`相当) | — | — | ✅移植済: `common/svg_patch.h/.cpp` (converter完全版採用) |
| エンコード部 | renderers分散 | context内蔵 | `common/skia_encode` として切出し予定 (PNG/JPEG/WebP/AVIF横断) |
| スタブ (`skia_stubs.cpp`) | あり | あり | 重複排除して一本化 (SKSL除外前提の最小集合へ) |
| 実行コンテキスト | `SatoruContext` | `ImageConverterContext` | 分離維持 (描画状態と変換状態は寿命・所有権が異なるため統合しない) |
| デコーダ (`image_decoder` / codec利用) | あり | あり | ✅移植済: `common/image_decoder.h/.cpp` (converter全フレーム+EXIF正、satoru SVG統合) |
| ThumbHash | なし | `utils/thumbhash.cpp` | converter側を持ち込む |
| PDFマージャ (`pdf_merger`) | あり | なし | satoru側を持ち込む |

## 禁止事項

- 既存2リポ (`satoru`, `wasm-image-optimization`) は読取のみ。変更・コピー自動化なし。
- `packages/html-to-image/*` には触らない (TS層はPhase1のまま)。

## 移植済み (実ファイルあり)

- `common/skia_encode.h/.cpp` (namespace `html_to_image`):
  image-opt `api/image_converter_api.cpp:172-309` のencode分岐を移植。
  `encode_png` / `encode_webp_single` / `encode_jpeg` / `encode_avif` /
  `encode_raw` / `encode_thumbhash` のprimitive +
  dispatcher `encode_frames` / `encode_single_bitmap` (`EncodeFrameView`,
  `EncodeResult`, `ConverterEncodeOptions` 受け。`context.set_last_output` 等の
  文脈保持は呼び出し側の責務として含まない)。
  採用判断: animated WebP (`animation && frames>1` → `EncodeAnimated`) は
  image-opt版を正とする。satoru `png_renderer.cpp` (既定`{}`) /
  `webp_renderer.cpp` (lossless固定+quality 100単帧) / `pdf_renderer.cpp`
  (PdfJpegEncoder, quality int) の使い方は各primitiveの特殊化と等価のため
  個別移植なし。SVG/PDF形式指定は元実装どおり未対応 (null) を維持。
  `rgbaToThumbHash` 実体は `common/thumbhash` 移植時に持ち込む (現状は外部定義へリンク)。
- `common/lru_cache.h` (namespace `html_to_image::LruCache`):
  両リポ同一ロジックのため共通化1本。採用判断: 差異はnamespace
  (`satoru` vs `image_converter`) のみで実装差なし。ガードを
  `HTML_TO_IMAGE_LRU_CACHE_H` に変更、`<cstddef>` を追加した以外は逐語同一。
- `common/skia_utils.h/.cpp` (グローバル関数、satoru版supersetを正):
  `clean_font_name` / `base64_encode` / `base64_decode` / `url_decode` /
  `make_rrect` (+ `image_info`) をsatoru版から逐語移植。
  採用判断: image-opt版は前3者のサブセットで追加関数なしのため不採用。
  ガードを `HTML_TO_IMAGE_SKIA_UTILS_H` に変更した以外は同一。

## 移植済: image_decoder / svg_patch

- `common/image_decoder.h/.cpp` (namespace `html_to_image`)
  - ラスタ正本: converter `load_image` (全フレーム + `getOrigin`/`SkEncodedOriginSwapsWidthHeight`/
    `SkPixmapUtils::Orient` による EXIF 補正 + format/animated 付与)。satoru版 (先頭フレームのみ・Orient無し) は不採用。
  - SVG: satoru `decode_svg` 統合 (SkSVGDOM + DataURIResourceProvider + font_mgr/`RefEmpty` + 512 fallback)。
    判定は satoru式 (先頭空白スキップ+`<`) を採用し、事前に `patch_svg_data` を適用。`decode_first` で satoru互換も提供。
- `common/svg_patch.h/.cpp`: converter `patch_svg_data` 完全版 (feDropShadow展開/pattern内linearGradient取出し/url置換/
  image href→xlink:href+xmlns補完) を採用。satoru版は no-op (ctre Wasmスタック問題コメント) のため不採用。
- CMakeLists.txt 追記なし (別レーン)。ビルド未実行・目視整合のみ。

## 単一WASM完成作業 (common配線 + api設計ヘッダ)

- `common/thumbhash.h/.cpp` (namespace `html_to_image`):
  image-opt `utils/thumbhash.h/.cpp` を移植 (ガードを `HTML_TO_IMAGE_THUMBHASH_H` に変更し
  namespace化した以外は逐語同一)。`skia_encode.cpp` の `rgbaToThumbHash` 外部定義前提の
  リンク未解決を解消する (`skia_encode.cpp` は `thumbhash.h` をincludeし同namespace解決へ)。
  旧グローバル名 `::rgbaToThumbHash` での参照は禁止。
- `api/unified_api.h` (新規、薄い設計ヘッダのみ・実装なし):
  Satoru描画結果 `SkBitmap` → Converter encode へPNG中間なしで渡す受渡し設計。
  `render_bitmap_to_encoded(SkBitmap, ConverterEncodeOptions) → EncodeResult` を宣言し、
  `common/skia_encode` の `encode_single_bitmap` / `encode_frames` 経由で呼ぶ方針、
  lifetime注意 (bitmap所有権は呼び出し側保持・viewのdangling禁止・raw_passthroughのmove受渡し) を示す。
- `CMakeLists.txt`: `html_to_image_core` に `common/` の全cpp
  (`image_decoder`, `svg_patch`, `skia_encode`, `skia_utils`, `thumbhash`) を追加する最小追記のみ。
  既存オプション値 (`WASM_EXPORT_NAME` / `WASM_AVIF_BACKEND` / `WASM_ENABLE_*` 等) は変更なし。
- ビルド未実行・目視整合のみ。`packages/html-to-image/*` は不変。
