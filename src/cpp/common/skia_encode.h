#ifndef HTML_TO_IMAGE_SKIA_ENCODE_H
#define HTML_TO_IMAGE_SKIA_ENCODE_H

// common/skia_encode: PNG/WebP/JPEG/AVIF/RAW/ThumbHash encode分岐の共通化。
// 正本: `@node-libraries/wasm-image-optimization/src/cpp/api/image_converter_api.cpp:172-309`
//       `ImageConverterInstance::encode` の switch 全分岐を、インスタンス非依存の
//       フレームview + オプション受けに切り出したもの。animated WebP対応は
//       image-opt版を正とする (animation && frames>1 のとき EncodeAnimated)。
//
// satoru側 renderers との対応 (いずれも下記primitiveの特殊化と等価):
//  - png_renderer.cpp: `SkPngEncoder::Encode(&stream, bitmap.pixmap(), {})`
//    == encode_png(pixmap)
//  - webp_renderer.cpp: lossless固定 + quality=100.0f の単帧Encode
//    == encode_webp_single(pixmap, 100.0f)
//  - pdf_renderer.cpp: PdfJpegEncoder (quality int受け)
//    == encode_jpeg(pixmap, quality)
// PDFドキュメント自体 (SkPDF::MakeDocument) は対象外。dispatcherでの
// SVG/PDF形式指定は未対応 (null result) のまま: 画像→SVG/PDFは dispatcher
// を経由せず `converter_encode_svg` / `converter_encode_pdf` (unified_api経由)
// で対応済みのため。

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "../bridge/bridge_types.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkData.h"

namespace html_to_image {

// 呼び出し側 (converterのImageFrame / rendererの単体SkBitmap) に依存しない
// 最小view。bitmapの所有権は呼び出し側が保持する。
struct EncodeFrameView {
    const SkBitmap* bitmap = nullptr;
    int duration = 0;  // ms。animated WebP以外では不使用
};

struct EncodeResult {
    sk_sp<SkData> data;          // 成功時のみ非null
    std::string format_name;     // "png"/"webp"/"jpeg"/"avif"/"raw"/"thumbhash"/"unknown"
    bool is_animation = false;   // animated WebPで実際に複数帧を符号化したときのみtrue
    bool success() const { return data != nullptr; }
};

// --- 単形式primitive (satoru renderersの使い方と1:1) ---

sk_sp<SkData> encode_png(const SkPixmap& pixmap);

// PNG encode + base64 `data:image/png` URL. Shared implementation behind
// `svg_renderer.cpp` `bitmapToDataUrl` and `encode_image_to_svg` below.
// Returns "" when the bitmap cannot be encoded.
std::string encode_png_data_url(const SkBitmap& bitmap);
sk_sp<SkData> encode_webp_single(const SkPixmap& pixmap, float quality);
sk_sp<SkData> encode_jpeg(const SkPixmap& pixmap, int quality);
sk_sp<SkData> encode_avif(const SkBitmap& bitmap, int quality, int speed);
sk_sp<SkData> encode_raw(const SkBitmap& bitmap);

// ThumbHash実体 (rgbaToThumbHash) は common/thumbhash 移植時に持ち込む。
// 本ファイルは呼び出すのみ (image-opt版 `utils/thumbhash.h` と同シグネチャ)。
sk_sp<SkData> encode_thumbhash(const SkBitmap& bitmap);

// --- 分岐dispatcher (image-opt encode() switchの移植) ---
//
// frames[0] を単帧encoder入力とする点、None→raw_passthrough素通し、
// RAW/ThumbHashの即時return相当を含め、元switchの挙動を維持する。
// 文脈保持 (context.set_last_output等) は呼び出し側の責務とし、ここでは行わない。
EncodeResult encode_frames(const EncodeFrameView* frames, size_t count,
                           const ConverterEncodeOptions& options,
                           sk_sp<SkData> raw_passthrough = nullptr);

// 単体bitmap用 overload。
EncodeResult encode_single_bitmap(const SkBitmap& bitmap, const ConverterEncodeOptions& options,
                                  sk_sp<SkData> raw_passthrough = nullptr);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_SKIA_ENCODE_H
