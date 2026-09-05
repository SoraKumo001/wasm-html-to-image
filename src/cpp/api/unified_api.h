#ifndef HTML_TO_IMAGE_UNIFIED_API_H
#define HTML_TO_IMAGE_UNIFIED_API_H

// api/unified_api: Satoru描画結果 → Converter encode の受渡し設計 (ヘッダのみ・実装なし)。
//
// 方針: Satoru側が描画した SkBitmap をPNG等の*中間バイト列なし*で直接
// `common/skia_encode` の dispatcher へ渡す。シリアライズ/デシリアライズ往復を避け、
// SkBitmap のピクセルをそのまま encoder 入力とする。
//
// 宣言のみの薄い設計ヘッダ。実装 (.cpp) は Phase2 の api/*.cpp 移植時に提供する。
// 本ファイルは型宣言 + 呼び出し方針コメントのみを持ち、関数定義・Embind登録は含まない
// (mangle/登録名衝突を避けるため。実登録は src/cpp/main.cpp の satoru_*/converter_* で行う)。

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
// 想定実装 (Phase2): `encode_single_bitmap(bitmap, options)` (複数フレーム時は
// `encode_frames(views, count, options)`) を `common/skia_encode` 経由で呼ぶだけの
// 薄いラッパ。`context.set_last_output` 等の文脈保持は呼び出し側
// (SatoruInstance / ImageConverterInstance 側) の責務とし、ここでは行わない
// (skia_encode.h の dispatcher 設計に準拠)。
EncodeResult render_bitmap_to_encoded(const SkBitmap& bitmap,
                                      const ConverterEncodeOptions& options);

// --- Decoded-image -> vector wrappers (image-input svg/pdf path) ---
//
// SVG: bitmap を PNG encode → base64 data URL 化し、`<image>` 一枚で包む
// (svg_renderer.cpp の bitmapToDataUrl と等価。テキストはパス化しない)。
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
