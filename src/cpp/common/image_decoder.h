#ifndef HTML_TO_IMAGE_IMAGE_DECODER_H
#define HTML_TO_IMAGE_IMAGE_DECODER_H

#include <cstdint>
#include <string>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkRefCnt.h"

namespace html_to_image {

struct DecodedFrame {
    SkBitmap bitmap;
    int duration_ms = 0;  // アニメーション以外は 0
};

struct DecodeResult {
    std::vector<DecodedFrame> frames;
    int width = 0;
    int height = 0;
    std::string format = "unknown";  // png/jpeg/webp/gif/avif/bmp/svg
    bool animated = false;

    bool ok() const { return !frames.empty(); }
};

class ImageDecoder {
   public:
    // ラスタ + SVG の全フレームデコード。正本は converter側
    // load_image (image_converter_api.cpp:70-170)。
    // EXIF Orientation 補正 (getOrigin + SkEncodedOriginSwapsWidthHeight +
    // SkPixmapUtils::Orient) を必須で行う。
    // SVG パスは satoru側 decode_svg を統合し、事前に svg_patch.h の
    // patch_svg_data を適用する。
    static DecodeResult decode(const uint8_t* data, size_t size,
                               sk_sp<SkFontMgr> font_mgr = nullptr);

    // satoru側 ImageDecoder::decode 互換の先頭フレームのみ返却。
    // out_width/out_height に先頭フレーム寸法を格納する。
    static sk_sp<SkImage> decode_first(const uint8_t* data, size_t size, int& out_width,
                                       int& out_height, sk_sp<SkFontMgr> font_mgr = nullptr);

   private:
    static bool is_likely_svg(const uint8_t* data, size_t size);
    static DecodeResult decode_svg(const sk_sp<SkData>& data, sk_sp<SkFontMgr> font_mgr);
};

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_IMAGE_DECODER_H
