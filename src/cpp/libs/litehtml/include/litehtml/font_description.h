#ifndef LITEHTML_FONT_DESCRIPTION
#define LITEHTML_FONT_DESCRIPTION

#include <cstdint>
#include <string>
#include <vector>

#include "background.h"
#include "css_length.h"
#include "types.h"
#include "web_color.h"

namespace litehtml {
// One resolved OpenType feature setting (font-variant-* / font-feature-settings).
struct font_feature_setting {
    uint32_t tag = 0;
    uint32_t value = 1;
};

// One resolved variable-font axis setting (font-variation-settings).
struct font_variation_setting {
    uint32_t tag = 0;
    float value = 0;
};

struct font_description {
    std::string family;                               // Font Family
    pixel_t size = 0;                                 // Font size
    font_style style = font_style_normal;             // Font stype, see the enum font_style
    int weight;                                       // Font weight.
    int decoration_line = text_decoration_line_none;  // Decoration line. A bitset of flags of the
                                                      // enum text_decoration_line
    css_length decoration_thickness;
    css_length underline_offset;  // Decoration line thickness in pixels. See predefined values in
                                  // enumtext_decoration_thickness
    text_decoration_style decoration_style =
        text_decoration_style_solid;  // Decoration line style. See enum text_decoration_style
    web_color decoration_color = web_color::current_color;  // Decoration line color
    int decoration_skip_ink = text_decoration_skip_ink_auto;  // text-decoration-skip-ink
    int underline_position = text_underline_position_auto;    // text-underline-position
    std::string emphasis_style;                             // Text emphasis style
    web_color emphasis_color = web_color::current_color;    // Text emphasis color
    int emphasis_position = text_emphasis_position_over;
    text_orientation orientation = text_orientation_mixed;
    text_combine_upright text_combine_upright_ = text_combine_upright_none;
    pixel_t letter_spacing = 0;
    pixel_t word_spacing = 0;
    shadow_vector text_shadow;
    pixel_t text_stroke_width = 0;  // -webkit-text-stroke-width, in px
    web_color text_stroke_color = web_color::current_color;  // -webkit-text-stroke-color

    // Resolved OpenType features, low priority first (font-variant-* then
    // font-feature-settings) so later entries can override earlier ones.
    std::vector<font_feature_setting> features;

    // font-stretch, as a percentage of the normal width (100 = normal).
    int stretch = 100;

    // Resolved variable-font axes (font-variation-settings).
    std::vector<font_variation_setting> variations;

    std::string hash() const {
        std::string out;
        out += family;
        out += ":sz=" + std::to_string(size);
        out += ":st=" + std::to_string(style);
        out += ":w=" + std::to_string(weight);
        out += ":str=" + std::to_string(stretch);
        out += ":dl=" + std::to_string(decoration_line);
        out += ":dt=" + decoration_thickness.to_string();
        out += ":uo=" + underline_offset.to_string();
        out += ":ds=" + std::to_string(decoration_style);
        out += ":dc=" + decoration_color.to_string();
        out += ":dsi=" + std::to_string(decoration_skip_ink);
        out += ":up=" + std::to_string(underline_position);
        out += ":ephs=" + emphasis_style;
        out += ":ephc=" + emphasis_color.to_string();
        out += ":ephp=" + std::to_string(emphasis_position);
        out += ":or=" + std::to_string(orientation);
        out += ":tcu=" + std::to_string(text_combine_upright_);
        out += ":ls=" + std::to_string(letter_spacing);
        out += ":ws=" + std::to_string(word_spacing);
        for (const auto& s : text_shadow) {
            out += ":ts=" + std::to_string(s.x.val()) + "," + std::to_string(s.y.val()) + "," +
                   std::to_string(s.blur.val()) + "," + s.color.to_string();
        }
        // Only differentiate fonts when a stroke is actually painted, so ordinary
        // text keeps sharing cached fonts regardless of its stroke color.
        if (text_stroke_width > 0) {
            out += ":tsw=" + std::to_string(text_stroke_width);
            out += ":tsc=" + text_stroke_color.to_string();
        }
        for (const auto& f : features) {
            out += ":ff=" + std::to_string(f.tag) + "=" + std::to_string(f.value);
        }
        for (const auto& v : variations) {
            out += ":var=" + std::to_string(v.tag) + "=" + std::to_string(v.value);
        }

        return out;
    }
};
}  // namespace litehtml

#endif
