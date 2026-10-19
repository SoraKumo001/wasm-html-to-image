#include "webp_anim_encoder.h"

#include <cstdint>
#include <memory>
#include <new>

#include "include/core/SkAlphaType.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkColorType.h"
#include "include/core/SkStream.h"
// Skia private (Skia の WebP encoder と同じ物を使うため):
//   SkPixmapIsValid の実体がここにある。
#include "src/encode/SkImageEncoderPriv.h"

#include "webp/encode.h"
#include "webp/mux.h"
#include "webp/mux_types.h"

namespace html_to_image {
namespace {

// libwebp の pixel importer 群 (Skia `SkWebpEncoderImpl.cpp` と同じ定義)。
// libwebp の public header には typedef が無いため、ここで定義する。
using WebPPictureImportProc = int (*)(WebPPicture* picture, const uint8_t* pixels,
                                      int stride);

// WebPPicture の RAII (Skia の `SkAutoTCallVProc<WebPPicture, WebPPictureFree>` 相当)。
struct PictureDeleter {
    void operator()(WebPPicture* picture) const {
        if (picture) WebPPictureFree(picture);
    }
};
using PicturePtr = std::unique_ptr<WebPPicture, PictureDeleter>;

// WebPAnimEncoder の RAII。
struct AnimEncoderDeleter {
    void operator()(WebPAnimEncoder* enc) const {
        if (enc) WebPAnimEncoderDelete(enc);
    }
};
using AnimEncoderPtr = std::unique_ptr<WebPAnimEncoder, AnimEncoderDeleter>;

// Skia `src/encode/SkWebpEncoderImpl.cpp` の `preprocess_webp_picture` 相当。
// libwebp 呼び出し列を Skia と同一に保つため、色変換・config設定も在一起する
// (差分があると同一入力でも出力バイトが変わる)。
bool preprocess_webp_picture(WebPPicture* pic, WebPConfig* webp_config,
                             const SkPixmap& pixmap, bool lossless) {
    if (!SkPixmapIsValid(pixmap)) {
        return false;
    }
    if (SkColorTypeIsAlphaOnly(pixmap.colorType())) {
        // alpha-only は libwebp 側の対応がない (Skia と同じ扱い)。
        return false;
    }
    if (nullptr == pixmap.addr()) {
        return false;
    }

    pic->width = pixmap.width();
    pic->height = pixmap.height();

    if (!lossless) {
        webp_config->lossless = 0;
#ifndef SK_WEBP_ENCODER_USE_DEFAULT_METHOD
        webp_config->method = 3;
#endif
        pic->use_argb = 0;
    } else {
        webp_config->lossless = 1;
        webp_config->method = 0;
        pic->use_argb = 1;
    }

    {
        const SkColorType ct = pixmap.colorType();
        const bool premul = pixmap.alphaType() == kPremul_SkAlphaType;

        SkBitmap tmpBm;
        WebPPictureImportProc importProc = nullptr;
        const SkPixmap* src = &pixmap;
        if (ct == kRGB_888x_SkColorType) {
            importProc = WebPPictureImportRGBX;
        } else if (!premul && ct == kRGBA_8888_SkColorType) {
            importProc = WebPPictureImportRGBA;
        }
#ifdef WebPPictureImportBGRA
        else if (!premul && ct == kBGRA_8888_SkColorType) {
            importProc = WebPPictureImportBGRA;
        }
#endif
        else {
            importProc = WebPPictureImportRGBA;
            auto info = pixmap.info()
                                .makeColorType(kRGBA_8888_SkColorType)
                                .makeAlphaType(kUnpremul_SkAlphaType);
            if (!tmpBm.tryAllocPixels(info) ||
                !pixmap.readPixels(tmpBm.info(), tmpBm.getPixels(), tmpBm.rowBytes())) {
                return false;
            }
            src = &tmpBm.pixmap();
        }

        if (!importProc(pic, reinterpret_cast<const uint8_t*>(src->addr()),
                        src->rowBytes())) {
            return false;
        }
    }

    return true;
}

}  // namespace

sk_sp<SkData> encode_webp_animated(const WebpAnimFrame* frames, size_t count,
                                    float quality, bool lossless, int loop_count,
                                    uint32_t bgcolor) {
    if (frames == nullptr || count == 0) return nullptr;

    const int canvas_width = frames[0].pixmap.width();
    const int canvas_height = frames[0].pixmap.height();
    if (canvas_width <= 0 || canvas_height <= 0) return nullptr;

    // libwebp の既定オプション (loop無限 / bgcolor不透明白) から
    // loop_count と bgcolor だけを上書きする。Skia の
    // `WebPAnimEncoderNew(w, h, nullptr)` と同じ既定値になるため、
    // loop_count=0 のときは従来経路と出力がバイト一致する。
    WebPAnimEncoderOptions anim_options;
    if (!WebPAnimEncoderOptionsInit(&anim_options)) return nullptr;
    anim_options.anim_params.loop_count = loop_count > 0 ? loop_count : 0;
    anim_options.anim_params.bgcolor = bgcolor;

    AnimEncoderPtr enc(WebPAnimEncoderNew(canvas_width, canvas_height, &anim_options));
    if (!enc) return nullptr;

    int timestamp = 0;
    for (size_t i = 0; i < count; ++i) {
        const SkPixmap& pixmap = frames[i].pixmap;
        if (pixmap.width() != canvas_width || pixmap.height() != canvas_height) {
            return nullptr;
        }

        WebPConfig webp_config;
        if (!WebPConfigPreset(&webp_config, WEBP_PRESET_DEFAULT, quality)) {
            return nullptr;
        }

        PicturePtr pic(new (std::nothrow) WebPPicture());
        if (!pic) return nullptr;
        if (!WebPPictureInit(pic.get())) return nullptr;

        if (!preprocess_webp_picture(pic.get(), &webp_config, pixmap, lossless)) {
            return nullptr;
        }
        if (!WebPEncode(&webp_config, pic.get())) return nullptr;

        if (!WebPAnimEncoderAdd(enc.get(), pic.get(), timestamp, &webp_config)) {
            return nullptr;
        }

        timestamp += frames[i].duration;
    }

    // 最終フレームの duration を確定させるための NULL Add (Skia と同じ順序)。
    if (!WebPAnimEncoderAdd(enc.get(), nullptr, timestamp, nullptr)) return nullptr;

    WebPData assembled;
    WebPDataInit(&assembled);
    if (!WebPAnimEncoderAssemble(enc.get(), &assembled)) {
        WebPDataClear(&assembled);
        return nullptr;
    }

    SkDynamicMemoryWStream stream;
    const bool written = stream.write(assembled.bytes, assembled.size);
    WebPDataClear(&assembled);
    if (!written) return nullptr;
    return stream.detachAsData();
}

}  // namespace html_to_image
