# core/ 移植要否リスト (satoru側core巨大のため一括移植しない)

移植済み:
- `core/ilogger.h` — 正本 `satoru/.../core/ilogger.h` 逐語 (ガード・パス差のみ)
- `core/satoru_context.h/.cpp` — 正本 `satoru/.../core/satoru_context.h/.cpp` 改名移植。
  fontManager/UnicodeService/Shaper/cacheManager は前置宣言+TODOスタブ化 (下記)。
- `core/image_converter_context.h/.cpp` — 正本 `image-opt/.../core/*` 逐語 (ガード差のみ)

未移植 (要否と順序):
1. `core/font_manager.h/.cpp` — 要。`SatoruContext::fontManager` 実体化と
   `satoru_api` font系 (`load_font/fallback`, `scanFontFaces`, diagnostics) 実働化に必須。
   依存: `core/ifont_manager.h`, `core/text/unicode_service.h`, litehtml。
2. `core/resource_manager.h/.cpp` + `core/resource_string_utils.h` — 要。
   `SatoruInstance::collect_resources/add_resource/pending_resources` 実働化に必須。
3. `core/container_skia.h/.cpp` + `container_skia_{clip,filters,helpers,transforms}.cpp`
   + `container_skia_helpers.h` — 要 (最大)。全描画・レイアウト・collectの中核。
   依存: litehtml, font_manager, text/*, skia_utils。単独Phaseとして分割移植推奨。
4. `core/text/` — 要 (container_skia の依存)。`text_types.h`, `unicode_service.h`,
   shaping/measure 系。`satoru_cache_manager.h` も text_types 依存のため同梱で移植。
5. `core/satoru_cache_manager.h` — 要 (text/ と同時。上記4完了後に `SatoruContext` へ復帰)。
6. `core/master_css.h`, `core/layout_utils.h`, `core/logical_canvas.h`,
   `core/logical_geometry.h`, `core/svg_tag_utils.h`, `core/el_svg.h/.cpp`,
   `core/litehtml_extensions.cpp`, `core/text_utils.h/.cpp`,
   `core/null_logger.h`, `core/ifont_manager.h` — 要 (container_skia/font 移植時に同梱)。
   単独では不要。
7. `core/generated/` — 要否確認中。生成物のため参照元リポの生成手順を確認してから判断。
8. `renderers/` (`png/webp/svg/pdf_renderer.*`, `render_utils.h`) — 要。
   `satoru_api_html_to_*` 実働化に必須。container_skia 移植後に接続。
   方針: PNG/WebP の最終encodeは `common/skia_encode` に寄せる (対応表は同ヘッダに記載)。
9. `utils/` 残分 (`logging.h/.cpp`, `pdf_merger.*`, `skunicode_satoru.*`, `skia_stubs.cpp`)
   — `logging`/`pdf_merger` は要 (`satoru_api` のログ・merge_pdfs 用)。
   `skunicode_satoru` は text/ と同時。`skia_stubs` は不要見込み (単一WASM構成差)。
   `image_decoder` は移植済み (`common/image_decoder`) のため除外。
10. `api/js_logger.h/.cpp` — 要 (小)。`satoru_api_set_log_level` 実働化用。単独移植可。
11. `libs/` — 取込不要。litehtml は CMake `litehtml` ターゲットで参照済み
    (`src/cpp/libs/litehtml` 存在確認済み)。skia は FetchContent `skia` 参照
    (`src/cpp/libs/skia` は SkUserConfig 等の config のみ)。
