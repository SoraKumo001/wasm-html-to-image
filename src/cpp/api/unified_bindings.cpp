#include "unified_bindings.h"

#include <memory>

#include "../common/skia_encode.h"
#include "converter_api.h"
#include "satoru_api.h"
#include "satoru_bindings.h"
#include "unified_api.h"

using namespace emscripten;

// ---- html_to_image (unified_api.h render_bitmap_to_encoded のJS公開形) ----
// render_bitmap_to_encoded 自体は const SkBitmap& 受けのためJS直結不可。
// JS公開形として HTML入力→C++内部で完結する unified (satoru描画→encode) とする:
//  - SVG/PDF: satoru_api_render 直出力 (satoruネイティブ形式)
//  - ラスタ: satoru_api_render でPNG中間 (C++内) → ImageDecoder::decode →
//    html_to_image::render_bitmap_to_encoded (= encode_frames 単帧直呼び) で最終encode。
// PNG中間はC++内に閉じ込め、JSへの受渡しは最終バイト列のみ (Bitmap直結方針)。
// 戻りviewのlifetime保持用 (tempインスタンス破棄後も有効化するためコピー保持)。
std::vector<uint8_t> g_last_unified_bytes;

val html_to_image_val(val htmls, int width, int height, int format, val options_val, float quality,
                      int speed, bool animation) {
    std::vector<std::string> html_vector = val_to_html_vector(htmls);
    if (html_vector.empty()) return val::null();
    SatoruRenderOptions render_options;
    parse_satoru_options(render_options, options_val);
    RenderFormat fmt = (RenderFormat)format;

    std::unique_ptr<SatoruInstance> satoru(satoru_api_create_instance());
    if (!satoru) return val::null();

    if (fmt == RenderFormat::SVG || fmt == RenderFormat::PDF) {
        int size = 0;
        const uint8_t* data =
            satoru_api_render(satoru.get(), html_vector, width, height, fmt, render_options, size);
        if (!data || size == 0) return val::null();
        g_last_unified_bytes.assign(data, data + size);
        return val(typed_memory_view(g_last_unified_bytes.size(), g_last_unified_bytes.data()));
    }

    // ラスタ系: 描画した SkBitmap をそのまま render_bitmap_to_encoded で最終encode
    // (PNG中間のencode/decode往復なし)。
    SkBitmap bitmap;
    if (!satoru_api_html_to_bitmap(satoru.get(), html_vector[0].c_str(), width, height,
                                   render_options, bitmap)) {
        return val::null();
    }
    ConverterEncodeOptions enc_options;
    enc_options.format = fmt;
    enc_options.quality = quality;
    enc_options.speed = speed;
    enc_options.animation = animation;
    html_to_image::EncodeResult result =
        html_to_image::render_bitmap_to_encoded(bitmap, enc_options);
    if (!result.success()) return val::null();
    size_t n = result.data->size();
    g_last_unified_bytes.assign(result.data->bytes(), result.data->bytes() + n);
    return val(typed_memory_view(g_last_unified_bytes.size(), g_last_unified_bytes.data()));
}

bool satoru_render_to_converter_val(SatoruInstance* satoru, ImageConverterInstance* converter,
                                    val htmls, int width, int height, val options_val) {
    if (!satoru || !converter) return false;
    std::vector<std::string> html_vector = val_to_html_vector(htmls);
    if (html_vector.empty()) return false;
    SatoruRenderOptions render_options;
    parse_satoru_options(render_options, options_val);

    SkBitmap bitmap;
    if (!satoru_api_html_to_bitmap(satoru, html_vector[0].c_str(), width, height, render_options,
                                   bitmap)) {
        return false;
    }
    converter->frames.clear();
    converter->raw_data = nullptr;
    converter->original_data = nullptr;
    converter->original_width = bitmap.width();
    converter->original_height = bitmap.height();
    converter->original_animation = false;
    converter->original_format = "png";
    ConverterImageFrame frame;
    frame.bitmap = std::move(bitmap);
    converter->frames.push_back(std::move(frame));
    return true;
}
