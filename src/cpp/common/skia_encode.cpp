#include "skia_encode.h"

#include <algorithm>
#include <cstring>
#include <jxl/encode.h>

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

std::vector<uint8_t> encode_jxl(const SkBitmap& bitmap, int quality, int speed) {
    const int width = bitmap.width();
    const int height = bitmap.height();
    const uint8_t* pixels = (const uint8_t*)bitmap.getPixels();
    if (width <= 0 || height <= 0 || pixels == nullptr) return {};
    // AVIF実装と同様にSkBitmapの画素をRGBA 8bit前提で取得する。
    // JxlEncoderAddImageFrameは連続バッファを要求するためrowBytesの
    // パディングを除去してtightなRGBAへ詰め直す。
    const size_t src_row_bytes = (size_t)bitmap.rowBytes();
    const size_t tight_row_bytes = (size_t)width * 4;
    std::vector<uint8_t> rgba(tight_row_bytes * (size_t)height);
    for (int y = 0; y < height; ++y) {
        std::memcpy(rgba.data() + (size_t)y * tight_row_bytes,
                    pixels + (size_t)y * src_row_bytes, tight_row_bytes);
    }
    const bool has_alpha = !bitmap.isOpaque();

    JxlEncoder* enc = JxlEncoderCreate(nullptr);
    if (enc == nullptr) return {};

    auto fail = [&enc]() {
        JxlEncoderDestroy(enc);
        return std::vector<uint8_t>{};
    };

    JxlBasicInfo basic_info;
    JxlEncoderInitBasicInfo(&basic_info);
    basic_info.xsize = (uint32_t)width;
    basic_info.ysize = (uint32_t)height;
    basic_info.bits_per_sample = 8;
    basic_info.exponent_bits_per_sample = 0;
    basic_info.num_color_channels = 3;
    basic_info.num_extra_channels = has_alpha ? 1 : 0;
    basic_info.alpha_bits = has_alpha ? 8 : 0;
    // libjxl requires uses_original_profile=true for lossless encoding
    // (JxlEncoderSetFrameLossless errors out otherwise, see encode.cc).
    const bool lossless = (quality >= 100);
    basic_info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
    if (JxlEncoderSetBasicInfo(enc, &basic_info) != JXL_ENC_SUCCESS) return fail();

    JxlColorEncoding color_encoding;
    JxlColorEncodingSetToSRGB(&color_encoding, JXL_FALSE);
    if (JxlEncoderSetColorEncoding(enc, &color_encoding) != JXL_ENC_SUCCESS) return fail();

    JxlEncoderFrameSettings* frame_settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
    if (frame_settings == nullptr) return fail();
    if (quality >= 100) {
        if (JxlEncoderSetFrameLossless(frame_settings, JXL_TRUE) != JXL_ENC_SUCCESS) {
            return fail();
        }
    } else {
        const float distance =
            std::clamp((100 - (float)quality) * 0.08f, 0.3f, 10.0f);
        if (JxlEncoderSetFrameDistance(frame_settings, distance) != JXL_ENC_SUCCESS) {
            return fail();
        }
    }
    const int64_t effort = std::clamp(10 - (int64_t)speed, (int64_t)1, (int64_t)9);
    if (JxlEncoderFrameSettingsSetOption(frame_settings, JXL_ENC_FRAME_SETTING_EFFORT,
                                         effort) != JXL_ENC_SUCCESS) {
        return fail();
    }

    JxlPixelFormat pixel_format;
    pixel_format.num_channels = 4;
    pixel_format.data_type = JXL_TYPE_UINT8;
    pixel_format.endianness = JXL_NATIVE_ENDIAN;
    pixel_format.align = 0;
    if (JxlEncoderAddImageFrame(frame_settings, &pixel_format, rgba.data(), rgba.size()) !=
        JXL_ENC_SUCCESS) {
        return fail();
    }
    JxlEncoderCloseInput(enc);

    // シングルスレッド (ParallelRunner不使用、WASM_THREADS=OFF前提)。
    std::vector<uint8_t> output(64 * 1024);
    uint8_t* next_out = output.data();
    size_t avail_out = output.size();
    while (true) {
        JxlEncoderStatus status = JxlEncoderProcessOutput(enc, &next_out, &avail_out);
        if (status == JXL_ENC_SUCCESS) break;
        if (status != JXL_ENC_NEED_MORE_OUTPUT) return fail();
        // avail_out>=32を保証しながら出力バッファを拡張する。
        const size_t offset = (size_t)(next_out - output.data());
        const size_t need = offset + 32;
        size_t grown = output.size() * 2;
        if (grown < need) grown = need;
        output.resize(grown);
        next_out = output.data() + offset;
        avail_out = output.size() - offset;
    }
    output.resize((size_t)(next_out - output.data()));
    JxlEncoderDestroy(enc);
    return output;
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
            // dispatcherでは未対応のまま (画像→SVGは converter_encode_svg 経由)。
            // (SkiaのSVG出力はcanvas再描画が必要なため元実装どおり。)
            return out;
        }
        case RenderFormat::AVIF: {
            out.format_name = "avif";
            out.data = encode_avif(first, (int)options.quality, options.speed);
            return out;
        }
        case RenderFormat::JXL: {
            out.format_name = "jxl";
            // 単帧のみ (animation無視)。
            std::vector<uint8_t> bytes =
                encode_jxl(first, (int)options.quality, options.speed);
            if (!bytes.empty()) {
                out.data = SkData::MakeWithCopy(bytes.data(), bytes.size());
            }
            return out;
        }
        case RenderFormat::PDF: {
            out.format_name = "pdf";
            // dispatcherでは未対応のまま (画像→PDFは converter_encode_pdf 経由。
            // 単画像からのPDF化は SkPDF 側の責務のため元実装どおり)。
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
