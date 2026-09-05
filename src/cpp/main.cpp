// Single-WASM entry point: satoru (HTML描画) + image-converter (変換) を1モジュールに統合。
//
// mangle衝突回避方針:
//  - 両リポとも extern "C" { create_instance / destroy_instance } と
//    api_create_instance / api_destroy_instance / api_set_log_level / api_load_image を定義しており、
//    そのままリンクすると多重定義/シンボル衝突になる。
//  - Phase2移植時に C++ 側API関数名自体を satoru_api_create_instance / converter_api_create_instance 等へ
//    改名し、Cエクスポートも satoru_create_instance / converter_create_instance に分離する。
//    (旧素朴名 create_instance 等のextern "C"エクスポートは作らない)
//  - JS-visibleなEmbind登録名も本ファイルの通り satoru_*/converter_* にprefix分離する。
//    set_log_level / load_image 等の衝突名は登録しない。
//  - 現時点では実装ソース未移植のため、本ファイルはバインディング形状の宣言のみ示す。
//    api/*.h の include は移植時に有効化する (下記コメント参照)。

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "bridge/bridge_types.h"

// Phase2で有効化: satoru側 / converter側 APIヘッダ
#include "api/converter_api.h"  // -> ImageConverterInstance, converter_api_* (改名後)
#include "api/satoru_api.h"     // -> SatoruInstance, satoru_api_* (改名後)
#include "api/unified_api.h"    // -> html_to_image::render_bitmap_to_encoded (encode_single_bitmap薄ラッパ)
#include "common/image_decoder.h"
#include "common/skia_encode.h"

// ---- Forward declarations (Phase2の改名後シグネチャ。定義は各api/*.cpp移植時に提供) ----
// (宣言は上記ヘッダが提供するため、重複する手書き宣言は置かない)

using namespace emscripten;

// ---- Shared helper (image-opt版 val_to_vector を採用: Uint8Array + ArrayBuffer 両対応) ----
static std::vector<uint8_t> val_to_vector(val data) {
    unsigned len = 0;
    if (data["length"].isUndefined()) {
        if (!data["byteLength"].isUndefined()) {
            len = data["byteLength"].as<unsigned>();
        }
    } else {
        len = data["length"].as<unsigned>();
    }
    std::vector<uint8_t> vec(len);
    if (len > 0) {
        val memoryView = val(typed_memory_view(len, vec.data()));
        if (data["length"].isUndefined()) {
            val uint8View = val::global("Uint8Array").new_(data);
            memoryView.call<void>("set", uint8View);
        } else {
            memoryView.call<void>("set", data);
        }
    }
    return vec;
}

// ---- satoru_* wrappers (HTML描画系。satoru main.cpp の parse_options/render_val系を移設) ----
// satoru_render は実在の satoru_api_render に接続 (配下 html_to_* は renderers/ 移植までTODOスタブ)。
// resource系は実体あり (TODOスタブでない) のみ登録:
// 登録済み: scan_css/load_image/set_font_map/get_last_*_size/get_collect_profile/
// set_collect_profile_enabled。未登録 (TODOスタブ): collect_resources/add_resource/
// load_font/load_fallback_font/load_image_pixels(C APIなし)/init_document/layout_document/
// render_from_state/merge_pdfs/get_pending_resources/get_font_diagnostics。

// ---- converter_* wrappers (画像変換系。image-opt main.cpp の encode_val系を移設) ----
// converter_encode は実在の converter_api_encode に接続 (common/skia_encode dispatcher経由で実働)。
// converter系は全件登録済み (実体は api/converter_api.cpp に存在・実働):
// load_image(valラッパ)/encode/crop/resize/get_original_width/get_original_height/
// is_original_animation/get_original_format/get_width/get_height/is_animation/get_format。

// satoru版 parse_options を SatoruRenderOptions 向けに移設 (フィールド1:1)。
static void parse_satoru_options(SatoruRenderOptions& options, val options_val) {
    if (options_val.isUndefined() || options_val.isNull()) return;
    if (options_val.hasOwnProperty("svgTextToPaths")) {
        options.svgTextToPaths = options_val["svgTextToPaths"].as<bool>();
    }
    if (options_val.hasOwnProperty("outputWidth")) {
        options.outputWidth = options_val["outputWidth"].as<int>();
    }
    if (options_val.hasOwnProperty("outputHeight")) {
        options.outputHeight = options_val["outputHeight"].as<int>();
    }
    if (options_val.hasOwnProperty("fitType")) {
        options.fitType = options_val["fitType"].as<int>();
    }
    if (options_val.hasOwnProperty("cropX")) {
        options.cropX = options_val["cropX"].as<int>();
    }
    if (options_val.hasOwnProperty("cropY")) {
        options.cropY = options_val["cropY"].as<int>();
    }
    if (options_val.hasOwnProperty("cropWidth")) {
        options.cropWidth = options_val["cropWidth"].as<int>();
    }
    if (options_val.hasOwnProperty("cropHeight")) {
        options.cropHeight = options_val["cropHeight"].as<int>();
    }
    if (options_val.hasOwnProperty("backgroundColor")) {
        options.backgroundColor = options_val["backgroundColor"].as<uint32_t>();
    }
    if (options_val.hasOwnProperty("fitPositionX")) {
        options.fitPositionX = options_val["fitPositionX"].as<float>();
    }
    if (options_val.hasOwnProperty("fitPositionY")) {
        options.fitPositionY = options_val["fitPositionY"].as<float>();
    }
    if (options_val.hasOwnProperty("mediaType")) {
        options.mediaType = options_val["mediaType"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfTitle")) {
        options.pdfTitle = options_val["pdfTitle"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfAuthor")) {
        options.pdfAuthor = options_val["pdfAuthor"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfSubject")) {
        options.pdfSubject = options_val["pdfSubject"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfKeywords")) {
        options.pdfKeywords = options_val["pdfKeywords"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfCreator")) {
        options.pdfCreator = options_val["pdfCreator"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfProducer")) {
        options.pdfProducer = options_val["pdfProducer"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfMarginTop")) {
        options.pdfMarginTop = options_val["pdfMarginTop"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginRight")) {
        options.pdfMarginRight = options_val["pdfMarginRight"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginBottom")) {
        options.pdfMarginBottom = options_val["pdfMarginBottom"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginLeft")) {
        options.pdfMarginLeft = options_val["pdfMarginLeft"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfHeader")) {
        options.pdfHeader = options_val["pdfHeader"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfFooter")) {
        options.pdfFooter = options_val["pdfFooter"].as<std::string>();
    }
}

static std::vector<std::string> val_to_html_vector(val htmls) {
    std::vector<std::string> html_vector;
    if (htmls.isArray()) {
        auto l = htmls["length"].as<unsigned>();
        for (unsigned i = 0; i < l; ++i) {
            html_vector.push_back(htmls[i].as<std::string>());
        }
    } else {
        html_vector.push_back(htmls.as<std::string>());
    }
    return html_vector;
}

// satoru版 render_val の改名移設。satoru_api_render (実在) に接続。
static val satoru_render_val(SatoruInstance* inst, val htmls, int width, int height, int format,
                             val options_val) {
    if (!inst) return val::null();
    std::vector<std::string> html_vector = val_to_html_vector(htmls);
    SatoruRenderOptions options;
    parse_satoru_options(options, options_val);
    int size = 0;
    const uint8_t* data = satoru_api_render(inst, html_vector, width, height,
                                            (RenderFormat)format, options, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// image-opt版 encode_val の改名移設。converter_api_encode (実在・実働) に接続。
static val converter_encode_val(ImageConverterInstance* inst, int format, float quality,
                                int speed, bool animation) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = converter_api_encode(inst, format, quality, speed, animation, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// 画像入力→SVG/PDF (converter instance の decode済み frames[0] を使用)。
// SVG は std::string 返却 (embind が JS 文字列へコピーするため lifetime 安全)。
// PDF は encode_val と同じ typed_memory_view + set_last_output 保持。
static std::string converter_encode_svg_val(ImageConverterInstance* inst) {
    if (!inst) return "";
    return inst->encode_svg();
}
static val converter_encode_pdf_val(ImageConverterInstance* inst) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = inst->encode_pdf(size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// converter_load_image: C APIは (inst, const uint8_t*, size_t)->success-indicator のため
// JS直結不可。Uint8Array/ArrayBuffer受けのvalラッパ経由で登録し、成否をboolで返す。
// (converter_api_load_image実体はapi/converter_api.cppに存在・実働。MakeWithCopyで同期コピー
// するためvecのlifetime問題なし)
static bool converter_load_image_val(ImageConverterInstance* inst, val data) {
    if (!inst || data.isUndefined() || data.isNull()) return false;
    std::vector<uint8_t> vec = val_to_vector(data);
    if (vec.empty()) return false;
    const uint8_t* r = converter_api_load_image(inst, vec.data(), vec.size());
    return r != nullptr;
}

// satoru_set_font_map: C APIは const std::map<std::string,std::string>& 受けのためJS直結不可。
// JSオブジェクト {family: url} 受けのvalラッパ経由で登録する。
static void satoru_set_font_map_val(SatoruInstance* inst, val fontMap) {
    if (!inst || fontMap.isUndefined() || fontMap.isNull()) return;
    std::map<std::string, std::string> m;
    val keys = val::global("Object").call<val>("keys", fontMap);
    unsigned n = keys["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i) {
        std::string k = keys[i].as<std::string>();
        m[k] = fontMap[k].as<std::string>();
    }
    satoru_api_set_font_map(inst, m);
}

// ---- html_to_image (unified_api.h render_bitmap_to_encoded のJS公開形) ----
// render_bitmap_to_encoded 自体は const SkBitmap& 受けのためJS直結不可。
// JS公開形として HTML入力→C++内部で完結する unified (satoru描画→encode) とする:
//  - SVG/PDF: satoru_api_render 直出力 (satoruネイティブ形式)
//  - ラスタ: satoru_api_render でPNG中間 (C++内) → ImageDecoder::decode →
//    html_to_image::render_bitmap_to_encoded (= encode_single_bitmap) で最終encode。
// PNG中間はC++内に閉じ込め、JSへの受渡しは最終バイト列のみ (Bitmap直結方針)。
// 戻りviewのlifetime保持用 (tempインスタンス破棄後も有効化するためコピー保持)。
static std::vector<uint8_t> g_last_unified_bytes;

static val html_to_image_val(val htmls, int width, int height, int format, val options_val,
                             float quality, int speed, bool animation) {
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

    // ラスタ系: PNG中間で描画 (現状 renderers/ 未移植のためスタブ経由。実働は移植後に接続)。
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

extern "C" {

// Cエクスポートもprefix分離する。素朴名 create_instance/destroy_instance は輸出禁止。
EMSCRIPTEN_KEEPALIVE
SatoruInstance* satoru_create_instance() { return satoru_api_create_instance(); }

EMSCRIPTEN_KEEPALIVE
void satoru_destroy_instance(SatoruInstance* inst) { satoru_api_destroy_instance(inst); }

EMSCRIPTEN_KEEPALIVE
ImageConverterInstance* converter_create_instance() { return converter_api_create_instance(); }

EMSCRIPTEN_KEEPALIVE
void converter_destroy_instance(ImageConverterInstance* inst) {
    converter_api_destroy_instance(inst);
}
}

// 単一EMSCRIPTEN_BINDINGS。旧2モジュール名 (satoru / image_converter) は廃止。
EMSCRIPTEN_BINDINGS(html_to_image) {
    class_<SatoruInstance>("SatoruInstance");
    class_<ImageConverterInstance>("ImageConverterInstance");

    // NOTE: 各メンバ関数の実体接続はPhase2 (api/*.cpp + core/* 移植時)。
    // JS名は衝突回避のため satoru_* / converter_* にprefix分離する:
    //   satoru_create_instance / satoru_destroy_instance / satoru_set_log_level /
    //   satoru_render / satoru_load_image / ... および
    //   converter_create_instance / converter_destroy_instance / converter_set_log_level /
    //   converter_load_image / converter_encode / converter_crop / converter_resize / ...
    // 素朴名 create_instance / destroy_instance / set_log_level / load_image での登録は禁止。
    function("satoru_create_instance", &satoru_create_instance, allow_raw_pointers());
    function("satoru_destroy_instance", &satoru_destroy_instance, allow_raw_pointers());
    function("satoru_set_log_level", &satoru_api_set_log_level);
    function("satoru_render", &satoru_render_val, allow_raw_pointers());
    // satoru resource系のうち実体あり (TODOスタブでない) のみ登録。
    // 除外 (TODOスタブ): collect_resources/add_resource/load_font/load_fallback_font/
    // init_document/layout_document/render_from_state/merge_pdfs/get_pending_resources/
    // get_font_diagnostics/html_to_* (renderers/移植までスタブ)。
    function("satoru_scan_css", &satoru_api_scan_css, allow_raw_pointers());
    function("satoru_load_image", &satoru_api_load_image, allow_raw_pointers());
    function("satoru_set_font_map", &satoru_set_font_map_val, allow_raw_pointers());
    function("satoru_get_last_png_size", &satoru_api_get_last_png_size, allow_raw_pointers());
    function("satoru_get_last_webp_size", &satoru_api_get_last_webp_size, allow_raw_pointers());
    function("satoru_get_last_pdf_size", &satoru_api_get_last_pdf_size, allow_raw_pointers());
    function("satoru_get_last_svg_size", &satoru_api_get_last_svg_size, allow_raw_pointers());
    function("satoru_get_collect_profile", &satoru_api_get_collect_profile, allow_raw_pointers());
    function("satoru_set_collect_profile_enabled", &satoru_api_set_collect_profile_enabled,
             allow_raw_pointers());
    function("converter_create_instance", &converter_create_instance, allow_raw_pointers());
    function("converter_destroy_instance", &converter_destroy_instance, allow_raw_pointers());
    function("converter_set_log_level", &converter_api_set_log_level);
    function("converter_load_image", &converter_load_image_val, allow_raw_pointers());
    function("converter_encode", &converter_encode_val, allow_raw_pointers());
    function("converter_encode_svg", &converter_encode_svg_val, allow_raw_pointers());
    function("converter_encode_pdf", &converter_encode_pdf_val, allow_raw_pointers());
    function("converter_crop", &converter_api_crop, allow_raw_pointers());
    // converter_resize の fit は必須引数として渡す (C++側既定値fit=0=Contain)。
    function("converter_resize", &converter_api_resize, allow_raw_pointers());
    function("converter_get_original_width", &converter_api_get_original_width,
             allow_raw_pointers());
    function("converter_get_original_height", &converter_api_get_original_height,
             allow_raw_pointers());
    function("converter_is_original_animation", &converter_api_is_original_animation,
             allow_raw_pointers());
    function("converter_get_original_format", &converter_api_get_original_format,
             allow_raw_pointers());
    function("converter_get_width", &converter_api_get_width, allow_raw_pointers());
    function("converter_get_height", &converter_api_get_height, allow_raw_pointers());
    function("converter_is_animation", &converter_api_is_animation, allow_raw_pointers());
    function("converter_get_format", &converter_api_get_format, allow_raw_pointers());
    function("html_to_image", &html_to_image_val);
}
