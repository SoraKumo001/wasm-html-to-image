#include "unified_bindings.h"

#include <memory>

#include "../common/image_decoder.h"
#include "../common/skia_encode.h"
#include "satoru_api.h"
#include "satoru_bindings.h"
#include "unified_api.h"

using namespace emscripten;

// ---- html_to_image (unified_api.h render_bitmap_to_encoded のJS公開形) ----
// render_bitmap_to_encoded 自体は const SkBitmap& 受けのためJS直結不可。
// JS公開形として HTML入力→C++内部で完結する unified (satoru描画→encode) とする:
//  - SVG/PDF: satoru_api_render 直出力 (satoruネイティブ形式)
//  - ラスタ: satoru_api_render でPNG中間 (C++内) → ImageDecoder::decode →
//    html_to_image::render_bitmap_to_encoded (= encode_single_bitmap) で最終encode。
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

    // ラスタ系: PNG中間で描画 → ImageDecoder::decode →
    // render_bitmap_to_encoded で最終encode。PNG中間はC++内に閉じる。
    int png_size = 0;
    const uint8_t* png_data = satoru_api_render(satoru.get(), html_vector, width, height,
                                                RenderFormat::PNG, render_options, png_size);
    if (!png_data || png_size == 0) return val::null();
    auto decoded = html_to_image::ImageDecoder::decode(png_data, (size_t)png_size, nullptr);
    if (!decoded.ok() || decoded.frames.empty()) return val::null();
    ConverterEncodeOptions enc_options;
    enc_options.format = fmt;
    enc_options.quality = quality;
    enc_options.speed = speed;
    enc_options.animation = animation;
    html_to_image::EncodeFrameView view{&decoded.frames[0].bitmap, decoded.frames[0].duration_ms};
    // render_bitmap_to_encoded 相当 (単帧のため encode_single_bitmap と等価。複数帧拡張時は
    // encode_frames(views...) に切替え。animated WebPは現 unified 単帧形では単帧扱い)。
    html_to_image::EncodeResult result =
        html_to_image::render_bitmap_to_encoded(*view.bitmap, enc_options);
    if (!result.success()) return val::null();
    size_t n = result.data->size();
    g_last_unified_bytes.assign(result.data->bytes(), result.data->bytes() + n);
    return val(typed_memory_view(g_last_unified_bytes.size(), g_last_unified_bytes.data()));
}
