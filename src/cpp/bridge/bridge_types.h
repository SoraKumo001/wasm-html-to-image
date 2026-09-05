#ifndef HTML_TO_IMAGE_BRIDGE_TYPES_H
#define HTML_TO_IMAGE_BRIDGE_TYPES_H

// Unified bridge types for the single-WASM build.
//  - satoru bridge_types.h: LogLevel + RenderFormat{SVG,PNG,WebP,PDF} + RenderOptions(HTML描画用, PDF余白等)
//  - image-opt bridge_types.h: LogLevel + RenderFormat{None=-1..ThumbHash=7} + FitMode + RenderOptions{svgTextToPathsのみ}
//  - 本ファイルは image-opt側の RenderFormat 全値域を正とし、FitMode を共通化する。
//    旧 `RenderOptions` の同名衝突を避けるため描画用/変換用に分離した。旧名での参照は禁止。

#include <cstdint>
#include <string>

enum class LogLevel { None = 0, Error = 1, Warning = 2, Info = 3, Debug = 4 };

// image-opt版の全値域を採用 (satoru側 0..3 と互換: SVG=0 PNG=1 WebP=2 PDF=3)
enum class RenderFormat {
    None = -1,
    SVG = 0,
    PNG = 1,
    WebP = 2,
    PDF = 3,
    JPEG = 4,
    AVIF = 5,
    RAW = 6,
    ThumbHash = 7
};

// image-opt版 FitMode を共通化 (satoru側 RenderOptions::fitType 0/1/2 と同義)
enum class FitMode { Contain = 0, Cover = 1, Fill = 2 };

// satoru側 RenderOptions の改名版 (HTML描画用)。フィールドは satoru版をそのまま継承。
struct SatoruRenderOptions {
    bool svgTextToPaths = true;
    int fitType = 0;  // 0=contain, 1=cover, 2=fill (FitModeと対応)
    int outputWidth = 0;
    int outputHeight = 0;
    int cropX = 0;
    int cropY = 0;
    int cropWidth = 0;
    int cropHeight = 0;
    uint32_t backgroundColor = 0x00000000;
    float fitPositionX = 0.5f;
    float fitPositionY = 0.5f;
    int mediaType = 0;  // 0=screen, 1=print

    // PDF Metadata
    std::string pdfTitle;
    std::string pdfAuthor;
    std::string pdfSubject;
    std::string pdfKeywords;
    std::string pdfCreator;
    std::string pdfProducer;

    // PDF Margins (pixels)
    int pdfMarginTop = 0;
    int pdfMarginRight = 0;
    int pdfMarginBottom = 0;
    int pdfMarginLeft = 0;

    // PDF Templates
    std::string pdfHeader;
    std::string pdfFooter;
};

// image-opt側エンコード引数 (format, quality, speed, animation) の構造体版。
// 旧 image-opt `RenderOptions{svgTextToPaths}` は廃止し、こちらに分離した。
struct ConverterEncodeOptions {
    RenderFormat format = RenderFormat::PNG;
    float quality = 85.0f;
    int speed = 6;
    bool animation = false;
    FitMode fit = FitMode::Contain;
};

void html_to_image_log(LogLevel level, const char* message);
// 旧 image-opt名の互換宣言。Phase2の移植完了時に html_to_image_log へ一本化する。
void image_converter_log(LogLevel level, const char* message);


// --- satoru描画系の共有構造体 (正本 satoru/.../bridge/bridge_types.h より継承) ---
// container_skia / renderers / font_manager が参照する font_request / font_info /
// shadow・gradient・filter系タグ情報を集約。LogLevel / RenderFormat は本ファイル上部の
// 統一版を正とし、描画オプションは SatoruRenderOptions を正とする。
// 旧 satoru名 `RenderOptions` は末尾の alias でのみ参照可。
#include <set>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "include/core/SkFont.h"
#include "include/core/SkFontStyle.h"
#include "libs/litehtml/include/litehtml.h"

struct font_request {
    std::string family;
    int weight;
    SkFontStyle::Slant slant;

    bool operator<(const font_request &other) const {
        if (family != other.family) return family < other.family;
        if (weight != other.weight) return weight < other.weight;
        return slant < other.slant;
    }
};

struct font_info {
    litehtml::font_description desc;
    std::vector<class SkFont *> fonts;
    int fm_ascent;
    int fm_height;
    float fm_ascent_raw;
    bool fake_bold;
    bool fake_italic;
    bool is_rtl;
    std::vector<font_request> requests;
    std::set<char32_t> used_codepoints;
    std::unordered_map<char32_t, SkFont> selected_font_cache;
    std::unordered_map<uint64_t, float> glyph_width_cache;
};

struct shadow_info {
    litehtml::web_color color;
    float blur;
    float x;
    float y;
    float spread;
    bool inset;
    litehtml::position box_pos;
    litehtml::border_radiuses box_radius;
    float opacity;

    auto as_tuple() const {
        return std::make_tuple(color.red, color.green, color.blue, color.alpha, blur, x, y, spread,
                               inset, box_pos.x, box_pos.y, box_pos.width, box_pos.height, opacity);
    }
    bool operator<(const shadow_info &other) const { return as_tuple() < other.as_tuple(); }
};

struct image_draw_info {
    std::string url;
    litehtml::background_layer layer;
    float opacity;
    bool has_clip = false;
    litehtml::position clip_pos;
    litehtml::border_radiuses clip_radius;
    litehtml::object_fit object_fit = litehtml::object_fit_fill;
    litehtml::css_token_vector object_position;
    int tag_index = 0;
};

struct border_image_info {
    litehtml::border_image border_image;
    litehtml::borders borders;
    litehtml::position draw_pos;
    float opacity;
};

struct conic_gradient_info {
    litehtml::background_layer layer;
    litehtml::background_layer::conic_gradient gradient;
    float opacity;
};

struct radial_gradient_info {
    litehtml::background_layer layer;
    litehtml::background_layer::radial_gradient gradient;
    float opacity;
};

struct image_resource_info {
    std::string url;
    std::vector<uint8_t> data;
};

struct linear_gradient_info {
    litehtml::background_layer layer;
    litehtml::background_layer::linear_gradient gradient;
    float opacity;
};

struct text_shadow_info {
    litehtml::shadow_vector shadows;
    litehtml::web_color text_color;
    float opacity;

    bool operator==(const text_shadow_info &other) const {
        if (shadows.size() != other.shadows.size()) return false;
        for (size_t i = 0; i < shadows.size(); ++i) {
            const auto &s1 = shadows[i];
            const auto &s2 = other.shadows[i];
            if (s1.color.red != s2.color.red || s1.color.green != s2.color.green ||
                s1.color.blue != s2.color.blue || s1.color.alpha != s2.color.alpha ||
                s1.blur.val() != s2.blur.val() || s1.x.val() != s2.x.val() ||
                s1.y.val() != s2.y.val() || s1.spread.val() != s2.spread.val() ||
                s1.inset != s2.inset)
                return false;
        }
        return text_color.red == other.text_color.red &&
               text_color.green == other.text_color.green &&
               text_color.blue == other.text_color.blue &&
               text_color.alpha == other.text_color.alpha && opacity == other.opacity;
    }
};

struct text_draw_info {
    int weight;
    bool italic;
    litehtml::web_color color;
    float opacity;

    bool operator==(const text_draw_info &other) const {
        return weight == other.weight && italic == other.italic && color.red == other.color.red &&
               color.green == other.color.green && color.blue == other.color.blue &&
               color.alpha == other.color.alpha && opacity == other.opacity;
    }
};

struct filter_info {
    litehtml::css_token_vector tokens;
    float opacity;
};

struct backdrop_filter_info {
    litehtml::css_token_vector tokens;
    litehtml::position box_pos;
    litehtml::border_radiuses box_radius;
    float opacity;
};

struct clip_info {
    litehtml::position pos;
    litehtml::border_radiuses radius;
};

struct clip_path_info {
    litehtml::css_token_vector tokens;
    litehtml::position pos;
};

struct mask_info {
    litehtml::css_token_vector tokens;
    litehtml::position pos;
};

struct glyph_draw_info {
    int glyph_index;
    int style_tag;
    int style_index;
};

// 旧 satoru名との互換 alias (フィールド1:1のため等価)。
using RenderOptions = SatoruRenderOptions;

#endif  // HTML_TO_IMAGE_BRIDGE_TYPES_H
