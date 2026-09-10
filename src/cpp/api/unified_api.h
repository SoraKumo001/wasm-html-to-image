#ifndef HTML_TO_IMAGE_UNIFIED_API_H
#define HTML_TO_IMAGE_UNIFIED_API_H

// api/unified_api: Satoru描画結果 → Converter encode の受渡し dispatcher。
//
// 方針: Satoru側が描画した SkBitmap をPNG等の*中間バイト列なし*で直接
// `common/skia_encode` の dispatcher 唯一入口 `encode_frames` へ渡す。
// シリアライズ/デシリアライズ往復を避け、SkBitmap のピクセルをそのまま encoder 入力とする。
//
// P1整理: satoru_*/converter_* 公開シンボルは main.cpp EMSCRIPTEN_BINDINGS (+C export)
// のため薄いラッパとして維持する (文字通りの内部関数化はABI/bindings破壊のため行わない)。
// 新規API・dispatcher追加は本ファイルに集約し、satoru_/converter_ 側への重複実装は避ける。
// 宣言の追加のみ可。既存シグネチャ変更・新規throwは禁止。

#include <cstddef>

#include "../bridge/bridge_types.h"
#include "../common/skia_encode.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkData.h"

namespace html_to_image {

// Satoru描画結果 SkBitmap → Converter encode への直接受渡し。
//
//   EncodeResult render_bitmap_to_encoded(const SkBitmap& bitmap,
//                                         const ConverterEncodeOptions& options);
//
// dispatcher唯一入口 `encode_frames` (単帧時は1要素view) を呼ぶだけの薄いラッパ。
// `encode_single_bitmap` は同等処理の overload として残すが、新規呼び出しは
// `encode_frames` へ寄せる。`context.set_last_output` 等の文脈保持は呼び出し側
// (SatoruInstance / ImageConverterInstance 側) の責務とし、ここでは行わない
// (skia_encode.h の dispatcher 設計に準拠)。
EncodeResult render_bitmap_to_encoded(const SkBitmap& bitmap,
                                      const ConverterEncodeOptions& options);

// --- Decoded-image -> vector wrappers (image-input svg/pdf path) ---
//
// SVG: bitmap を PNG encode → base64 data URL 化し、`<image>` 一枚で包む
// (common/skia_encode::encode_png_data_url を直接利用。テキストはパス化しない)。
// PDF: bitmap 一枚を 1 ページに等倍配置 (`drawImage`) した単頁PDF。
// いずれも所有権は呼び出し側の bitmap が保持する (同期実行のみ)。
std::string encode_image_to_svg(const SkBitmap& bitmap);
sk_sp<SkData> encode_image_to_pdf(const SkBitmap& bitmap);

// lifetime注意:
//  - bitmap の所有権は呼び出し側 (Satoru描画状態) が保持する。encode完了まで破棄禁止。
//  - `EncodeFrameView{&bitmap, duration}` のview化は関数スコープ内に閉じ込め、
//    呼び出し後に dangling 参照を残さないこと (encode_* は同期実行・コピー保持しない)。
//  - `raw_passthrough` (RenderFormat::None 用の素通しSkData) を渡す場合は、
//    呼び出し側が所有権 (sk_sp) を move で引き渡すこと。
//  - animated WebP (options.animation && frames>1) の複数帧版は、各 SkBitmap が
//    encode完了まで全帧生存していることを呼び出し側が保証すること。

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_UNIFIED_API_H
