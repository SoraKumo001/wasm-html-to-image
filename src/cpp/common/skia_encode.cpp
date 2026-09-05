#include "skia_encode.h"

#include "skia_utils.h"
#include "thumbhash.h"
#include "avif/avif.h"
#include "include/core/SkStream.h"
#include "include/encode/SkEncoder.h"
#include "include/encode/SkJpegEncoder.h"
#include "include/encode/SkPngEncoder.h"
#include "include/encode/SkWebpEncoder.h"

// rgbaToThumbHash 実体は common/thumbhash.h/.cpp (namespace html_to_image)。
// image-opt版 `utils/thumbhash.h` のグローバル関数を同ロジックで移植したもの。
namespace html_to_image {

sk_sp<SkData> encode_png(const SkPixmap& pixmap) {
    SkDynamicMemoryWStream stream;
    SkPngEncoder::Options options;
    if (!SkPngEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

std::string encode_png_data_url(const SkBitmap& bitmap) {
    if (bitmap.isNull() || bitmap.width() <= 0 || bitmap.height() <= 0) return "";
    if (bitmap.getPixels() == nullptr) return "";
    sk_sp<SkData> png = encode_png(bitmap.pixmap());
    if (!png || png->size() == 0) return "";
    return "data:image/png;base64," +
           base64_encode((const uint8_t*)png->data(), png->size());
}

sk_sp<SkData> encode_webp_single(const SkPixmap& pixmap, float quality) {
    SkDynamicMemoryWStream stream;
    SkWebpEncoder::Options options;
    options.fQuality = (int)quality;
    if (quality >= 100.0f) {
        options.fCompression = SkWebpEncoder::Compression::kLossless;
    } else {
        options.fCompression = SkWebpEncoder::Compression::kLossy;
    }
    if (!SkWebpEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

sk_sp<SkData> encode_jpeg(const SkPixmap& pixmap, int quality) {
    SkDynamicMemoryWStream stream;
    SkJpegEncoder::Options options;
    options.fQuality = quality;
    if (!SkJpegEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

sk_sp<SkData> encode_avif(const SkBitmap& bitmap, int quality, int speed) {
    SkDynamicMemoryWStream stream;
    avifRWData output = AVIF_DATA_EMPTY;
    avifImage* avif_image =
        avifImageCreate(bitmap.width(), bitmap.height(), 8, AVIF_PIXEL_FORMAT_YUV444);

    // Convert SkBitmap to AVIF RGB image
    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, avif_image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.pixels = (uint8_t*)bitmap.getPixels();
    rgb.rowBytes = (uint32_t)bitmap.rowBytes();

    if (avifImageRGBToYUV(avif_image, &rgb) != AVIF_RESULT_OK) {
        avifImageDestroy(avif_image);
        return nullptr;
    }

    avifEncoder* encoder = avifEncoderCreate();
    encoder->quality = quality;
    encoder->qualityAlpha = quality;
    encoder->speed = speed;

    sk_sp<SkData> result;
    avifResult avif_result = avifEncoderWrite(encoder, avif_image, &output);
    if (avif_result == AVIF_RESULT_OK) {
        stream.write(output.data, output.size);
        result = stream.detachAsData();
    }

    avifRWDataFree(&output);
    avifEncoderDestroy(encoder);
    avifImageDestroy(avif_image);
    return result;
}

sk_sp<SkData> encode_raw(const SkBitmap& bitmap) {
    return SkData::MakeWithCopy(bitmap.getPixels(), bitmap.computeByteSize());
}

sk_sp<SkData> encode_thumbhash(const SkBitmap& bitmap) {
    std::vector<uint8_t> hash =
        rgbaToThumbHash(bitmap.width(), bitmap.height(), (const uint8_t*)bitmap.getPixels());
    return SkData::MakeWithCopy(hash.data(), hash.size());
}

EncodeResult encode_frames(const EncodeFrameView* frames, size_t count,
                           const ConverterEncodeOptions& options,
                           sk_sp<SkData> raw_passthrough) {
    EncodeResult out;
    out.format_name = "unknown";
    if (frames == nullptr || count == 0 || frames[0].bitmap == nullptr) return out;
    const SkBitmap& first = *frames[0].bitmap;

    switch (options.format) {
        case RenderFormat::None: {
            if (raw_passthrough) {
                out.data = std::move(raw_passthrough);
                // 元実装は元画像の animation/format を引き継ぐのみで、
                // is_animation は false のまま (output_animation は事前に false へ初期化)。
                out.format_name = "passthrough";
            }
            return out;
        }
        case RenderFormat::PNG: {
            out.format_name = "png";
            out.data = encode_png(first.pixmap());
            return out;
        }
        case RenderFormat::WebP: {
            out.format_name = "webp";
            if (options.animation && count > 1) {
                std::vector<SkEncoder::Frame> sk_frames;
                sk_frames.reserve(count);
                for (size_t i = 0; i < count; ++i) {
                    if (frames[i].bitmap == nullptr) return out;
                    sk_frames.push_back({frames[i].bitmap->pixmap(), frames[i].duration});
                }
                SkDynamicMemoryWStream stream;
                SkWebpEncoder::Options woptions;
                woptions.fQuality = (int)options.quality;
                if (options.quality >= 100.0f) {
                    woptions.fCompression = SkWebpEncoder::Compression::kLossless;
                } else {
                    woptions.fCompression = SkWebpEncoder::Compression::kLossy;
                }
                if (SkWebpEncoder::EncodeAnimated(
                        &stream, SkSpan<const SkEncoder::Frame>(sk_frames.data(), sk_frames.size()),
                        woptions)) {
                    out.is_animation = true;
                    out.data = stream.detachAsData();
                }
                return out;
            }
            out.data = encode_webp_single(first.pixmap(), options.quality);
            return out;
        }
        case RenderFormat::JPEG: {
            out.format_name = "jpeg";
            out.data = encode_jpeg(first.pixmap(), (int)options.quality);
            return out;
        }
        case RenderFormat::SVG: {
            out.format_name = "svg";
            // 元実装どおり未対応 (SkiaのSVG出力はcanvas再描画が必要なため)。
            return out;
        }
        case RenderFormat::AVIF: {
            out.format_name = "avif";
            out.data = encode_avif(first, (int)options.quality, options.speed);
            return out;
        }
        case RenderFormat::PDF: {
            out.format_name = "pdf";
            // 元実装どおり未対応 (単画像からのPDF化は SkPDF 側の責務)。
            return out;
        }
        case RenderFormat::RAW: {
            out.format_name = "raw";
            out.data = encode_raw(first);
            return out;
        }
        case RenderFormat::ThumbHash: {
            out.format_name = "thumbhash";
            out.data = encode_thumbhash(first);
            return out;
        }
        default:
            return out;
    }
}

EncodeResult encode_single_bitmap(const SkBitmap& bitmap, const ConverterEncodeOptions& options,
                                  sk_sp<SkData> raw_passthrough) {
    EncodeFrameView view{&bitmap, 0};
    return encode_frames(&view, 1, options, std::move(raw_passthrough));
}

}  // namespace html_to_image
