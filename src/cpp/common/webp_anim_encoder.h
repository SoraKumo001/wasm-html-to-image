#ifndef HTML_TO_IMAGE_WEBP_ANIM_ENCODER_H
#define HTML_TO_IMAGE_WEBP_ANIM_ENCODER_H

// common/webp_anim_encoder: libwebp `WebPAnimEncoder` 直呼びの animated WebP エンコード。
//
// なぜ Skia の `SkWebpEncoder::EncodeAnimated` ではなく直呼びか:
//  - `EncodeAnimated` は `WebPAnimEncoderNew(w, h, nullptr)` 固定で、
//    `WebPAnimEncoderOptions.anim_params` の loop_count (再生回数) / bgcolor
//    (canvas背景色) を指定できない (= loop無限・bg白固定)。
//  - `webp/mux.h` の `WebPAnimEncoderOptions` なら両方を指定できる。
//    `libwebpmux` は vcpkg 版がリンク済み (cmake/fonts.cmake の `WebP::libwebpmux`)。
//
// 二重symbolについて:
//  - Skia 本体は libwebp を同梱せず vcpkg 版を costuma使うため、
//    本ファイルが使う `WebPAnimEncoder*` は skia_lib がリンクしている
//    同一の `WebP::libwebpmux` (同 `WebP::webp`) のシンボルになる。
//    Skia 内蔵の webp は存在しない (Skia archive に third_party は含まれない)。
//
// 出力互換:
//  - loop_count=0 (無限) / bgcolor=0xFFFFFFFF (不透明白) の既定値は
//    libwebp の `DefaultEncoderOptions` と一致し、呼び出し列も
//    Skia `EncodeAnimated` と同じ
//    (WebPConfigPreset → import → WebPEncode → WebPAnimEncoderAdd →
//     最終NULL Add → Assemble) なので、出力はバイト一致する。

#include <cstddef>
#include <cstdint>

#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"

namespace html_to_image {

// 1フレーム分の入力 (`SkEncoder::Frame` と同じ形)。
struct WebpAnimFrame {
    SkPixmap pixmap;
    int duration = 0;  // ms
};

// libwebp の既定背景色 (不透明白 = 0xAARRGGBB の A=FF,R=FF,G=FF,B=FF)。
// Skia `EncodeAnimated` と同じ値 ( bgcolor 固定問題 の既定値)。
constexpr uint32_t k_webp_anim_default_bgcolor = 0xFFFFFFFFu;

// animated WebP を libwebp `WebPAnimEncoder` で直接エンコードする。
//   frames     : フレーム列 (全フレーム同一サイズ必須)
//   quality    : 0-100 (Skia `SkWebpEncoder::Options::fQuality` と同じ値域)
//   lossless   : true = lossless (quality>=100 相当)
//   loop_count : 再生回数。0 = 無限回 (Skia 従来値)
//   bgcolor    : canvas背景色 (0xAARRGGBB)
//   method     : lossy の libwebp method 0..6 (0 が最速、既定 3 = Skia と同じ)
// 戻り値: 失敗時 nullptr。
sk_sp<SkData> encode_webp_animated(const WebpAnimFrame* frames, size_t count,
                                    float quality, bool lossless, int loop_count,
                                    uint32_t bgcolor, int method = 3);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_WEBP_ANIM_ENCODER_H
