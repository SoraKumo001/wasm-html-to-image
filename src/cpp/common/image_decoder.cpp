#include "image_decoder.h"

#include <memory>
#include <utility>

#include "include/codec/SkAvifDecoder.h"
#include "include/codec/SkBmpDecoder.h"
#include "include/codec/SkCodec.h"
#include "include/codec/SkEncodedImageFormat.h"
#include "include/codec/SkEncodedOrigin.h"
#include "include/codec/SkGifDecoder.h"
#include "include/codec/SkIcoDecoder.h"
#include "include/codec/SkJpegDecoder.h"
#include "include/codec/SkPixmapUtils.h"
#include "include/codec/SkPngDecoder.h"
#include "include/codec/SkWebpDecoder.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkStream.h"
#include "modules/skresources/include/SkResources.h"
#include "modules/svg/include/SkSVGDOM.h"
#include "modules/svg/include/SkSVGNode.h"
#include "modules/svg/include/SkSVGSVG.h"
#include "svg_patch.h"

namespace html_to_image {

DecodeResult ImageDecoder::decode(const uint8_t* data, size_t size, sk_sp<SkFontMgr> font_mgr) {
    DecodeResult result;
    if (!data || size == 0) return result;

    auto sk_data = SkData::MakeWithCopy(data, size);

    // 1. ラスタ (SkCodec 全フレーム + EXIF Orient 補正)。
    //    正本: converter側 load_image (image_converter_api.cpp:80-137)。
    //    satoru側 (image_decoder.cpp:40-53) は先頭フレームのみ・Orient 未補正のため不採用。
    if (std::unique_ptr<SkCodec> codec = SkCodec::MakeFromData(sk_data)) {
        const int frameCount = codec->getFrameCount();
        const SkEncodedOrigin origin = codec->getOrigin();
        const bool swapDimensions = SkEncodedOriginSwapsWidthHeight(origin);

        SkImageInfo info =
            codec->getInfo().makeColorType(kN32_SkColorType).makeAlphaType(kPremul_SkAlphaType);

        if (swapDimensions) {
            result.width = info.height();
            result.height = info.width();
        } else {
            result.width = info.width();
            result.height = info.height();
        }
        result.animated = frameCount > 1;

        switch (codec->getEncodedFormat()) {
            case SkEncodedImageFormat::kPNG: result.format = "png"; break;
            case SkEncodedImageFormat::kJPEG: result.format = "jpeg"; break;
            case SkEncodedImageFormat::kWEBP: result.format = "webp"; break;
            case SkEncodedImageFormat::kGIF: result.format = "gif"; break;
            case SkEncodedImageFormat::kAVIF: result.format = "avif"; break;
            case SkEncodedImageFormat::kBMP: result.format = "bmp"; break;
            default: result.format = "unknown"; break;
        }

        for (int i = 0; i < frameCount; ++i) {
            SkBitmap decodedBitmap;
            decodedBitmap.allocPixels(info);

            SkCodec::Options options;
            options.fFrameIndex = i;

            if (codec->getPixels(info, decodedBitmap.getPixels(), decodedBitmap.rowBytes(),
                                 &options) != SkCodec::kSuccess) {
                continue;
            }
            SkCodec::FrameInfo frameInfo;
            codec->getFrameInfo(i, &frameInfo);

            if (origin != kDefault_SkEncodedOrigin) {
                SkImageInfo orientedInfo = info;
                if (swapDimensions) {
                    orientedInfo = orientedInfo.makeWH(info.height(), info.width());
                }
                SkBitmap orientedBitmap;
                orientedBitmap.allocPixels(orientedInfo);
                if (SkPixmapUtils::Orient(orientedBitmap.pixmap(), decodedBitmap.pixmap(), origin)) {
                    result.frames.push_back({std::move(orientedBitmap), frameInfo.fDuration});
                } else {
                    result.frames.push_back({std::move(decodedBitmap), frameInfo.fDuration});
                }
            } else {
                result.frames.push_back({std::move(decodedBitmap), frameInfo.fDuration});
            }
        }
        if (!result.frames.empty()) return result;

        // codec は開けたが全フレーム失敗: 空のまま SVG フォールバックへ落とす。
        result.width = 0;
        result.height = 0;
        result.format = "unknown";
        result.animated = false;
    }

    // 2. SVG (satoru側 decode_svg を統合。事前に共通 patch_svg_data を適用)。
    //    判定ヒューリスティックは satoru側 (先頭空白スキップ + '<') を採用。
    //    converter側は data[0] == '<' の直接比較 + api_load_image 側で事前パッチのため、
    //    共通化後はこちらの decode 内で判定+パッチを完結させる。
    if (is_likely_svg(data, size)) {
        return decode_svg(patch_svg_data(sk_data), std::move(font_mgr));
    }

    return result;
}

sk_sp<SkImage> ImageDecoder::decode_first(const uint8_t* data, size_t size, int& out_width,
                                          int& out_height, sk_sp<SkFontMgr> font_mgr) {
    DecodeResult result = decode(data, size, std::move(font_mgr));
    if (!result.ok()) return nullptr;
    out_width = result.frames[0].bitmap.width();
    out_height = result.frames[0].bitmap.height();
    return result.frames[0].bitmap.asImage();
}

bool ImageDecoder::is_likely_svg(const uint8_t* data, size_t size) {
    const uint8_t* p = data;
    size_t s = size;
    while (s > 0 && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        ++p;
        --s;
    }
    return s >= 1 && p[0] == '<';
}

DecodeResult ImageDecoder::decode_svg(const sk_sp<SkData>& data, sk_sp<SkFontMgr> font_mgr) {
    DecodeResult result;
    SkMemoryStream stream(data);
    auto resource_provider = skresources::DataURIResourceProviderProxy::Make(
        nullptr, skresources::ImageDecodeStrategy::kLazyDecode);

    auto svg_dom = SkSVGDOM::Builder()
                       .setResourceProvider(std::move(resource_provider))
                       .setFontManager(font_mgr ? font_mgr : SkFontMgr::RefEmpty())
                       .make(stream);
    if (!svg_dom) return result;

    auto container_size = svg_dom->containerSize();
    if (container_size.isEmpty()) {
        container_size = SkSize::Make(512, 512);  // satoru/converter 共通のフォールバック
    }
    svg_dom->setContainerSize(container_size);

    result.width = (int)container_size.width();
    result.height = (int)container_size.height();
    result.format = "svg";
    result.animated = false;

    SkBitmap bitmap;
    if (!bitmap.tryAllocPixels(SkImageInfo::MakeN32Premul(result.width, result.height))) {
        result.width = 0;
        result.height = 0;
        result.format = "unknown";
        return result;
    }
    SkCanvas canvas(bitmap);
    canvas.clear(SK_ColorTRANSPARENT);
    svg_dom->render(&canvas);

    result.frames.push_back({std::move(bitmap), 0});
    return result;
}

}  // namespace html_to_image
