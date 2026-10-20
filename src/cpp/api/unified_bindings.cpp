#include "unified_bindings.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <memory>

#include <litehtml/css_parser.h>
#include <litehtml/css_tokenizer.h>
#include <litehtml/document.h>
#include <litehtml/element.h>
#include <litehtml/render_item.h>
#include <litehtml/string_id.h>
#include <litehtml/web_color.h>

#include "../common/skia_encode.h"
#include "core/animation_sampler.h"
#include "core/container_skia.h"
#include "renderers/png_renderer.h"
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

namespace {

// Recursively find the element whose inline `style` binds `name_l` via the
// `animation`/`animation-name` property. Used when no <style> selector binds
// the keyframes.
litehtml::element::ptr find_inline_animation_target(const litehtml::element::ptr& el,
                                                    const std::string& name_l) {
    if (!el) return nullptr;
    const char* style = el->get_attr("style");
    if (style) {
        const std::string s = html_to_image::detail::to_lower(style);
        if (s.find("animation") != std::string::npos && s.find(name_l) != std::string::npos) {
            return el;
        }
    }
    for (const auto& child : el->children()) {
        if (auto found = find_inline_animation_target(child, name_l)) return found;
    }
    return nullptr;
}

// Resolve a raw CSS colour value through the document's colour resolution so
// named colours, rgb()/rgba() and hsl() all work.
bool resolve_css_color(const std::string& value, html_to_image::Rgba& out) {
    litehtml::css_token_vector tokens = litehtml::tokenize(value);
    tokens = litehtml::normalize(tokens, litehtml::f_componentize | litehtml::f_remove_whitespace);
    if (tokens.size() != 1) return false;
    litehtml::web_color color;
    if (!litehtml::parse_color(tokens[0], color, nullptr)) return false;
    out.r = color.red;
    out.g = color.green;
    out.b = color.blue;
    out.a = color.alpha;
    return true;
}

// Resolve the raw colour stops. A stop whose value cannot be resolved is
// dropped (CSS treats an invalid value as "not animated at this keyframe").
std::vector<html_to_image::ColorKeyframe> resolve_color_stops(
    const std::vector<html_to_image::ColorStop>& raw) {
    std::vector<html_to_image::ColorKeyframe> out;
    out.reserve(raw.size());
    for (const auto& stop : raw) {
        html_to_image::Rgba color;
        if (!resolve_css_color(stop.value, color)) continue;
        html_to_image::ColorKeyframe keyframe;
        keyframe.offset = stop.offset;
        keyframe.color = color;
        out.push_back(keyframe);
    }
    return out;
}

// Maximum nesting depth of the var() substitution (a custom property may
// reference another one).
constexpr int k_max_var_depth = 8;

// Resolve the `var()` references of a CSS value with the element's custom
// properties. The document owns the custom properties, so the resolution
// happens here and the sampler keeps working on plain strings.
// An unknown property falls back to the `var()` fallback value; a reference
// that cannot be resolved is kept as-is.
std::string resolve_var_references(const litehtml::element::ptr& el,
                                   const std::string& value, int depth = 0) {
    if (depth > k_max_var_depth) return value;
    const std::string lower = html_to_image::detail::to_lower(value);
    std::string out;
    size_t i = 0;
    while (true) {
        const size_t pos = lower.find("var(", i);
        if (pos == std::string::npos) {
            out += value.substr(i);
            break;
        }
        // Find the closing parenthesis of the var() call.
        size_t end = std::string::npos;
        int parens = 0;
        for (size_t k = pos + 4; k < value.size(); ++k) {
            if (value[k] == '(') {
                ++parens;
                continue;
            }
            if (value[k] != ')') continue;
            if (parens > 0) {
                --parens;
                continue;
            }
            end = k;
            break;
        }
        if (end == std::string::npos) {
            out += value.substr(i);
            break;
        }
        out += value.substr(i, pos - i);

        const std::string args = value.substr(pos + 4, end - pos - 4);
        std::string name = args;
        std::string fallback;
        bool has_fallback = false;
        const size_t comma = args.find(',');
        if (comma != std::string::npos) {
            name = args.substr(0, comma);
            fallback = args.substr(comma + 1);
            has_fallback = true;
        }
        name = html_to_image::detail::trim(name);

        std::string replacement;
        bool resolved = false;
        if (el && name.size() > 2 && name.compare(0, 2, "--") == 0) {
            litehtml::css_token_vector tokens;
            if (el->get_custom_property(litehtml::_id(name), tokens)) {
                replacement = litehtml::get_repr(tokens);
                resolved = true;
            }
        }
        if (!resolved) {
            if (!has_fallback) {
                out += value.substr(pos, end - pos + 1);  // keep it unresolved
                i = end + 1;
                continue;
            }
            replacement = html_to_image::detail::trim(fallback);
        }
        out += resolve_var_references(el, replacement, depth + 1);
        i = end + 1;
    }
    return out;
}

// Resolve the `var()` references of every stop value of the animation and
// rebuild the animatable stops from the resolved values.
void resolve_animation_vars(html_to_image::AnimationSpec& spec,
                            const litehtml::element::ptr& el) {
    for (auto& raw : spec.opacity_raw) {
        raw.value = resolve_var_references(el, raw.value);
    }
    for (auto& raw : spec.transform_raw) {
        raw.value = resolve_var_references(el, raw.value);
    }
    for (auto& stop : spec.color_stops) {
        stop.value = resolve_var_references(el, stop.value);
    }
    for (auto& stop : spec.background_color_stops) {
        stop.value = resolve_var_references(el, stop.value);
    }
    html_to_image::build_animatable_stops(spec);
}

// The loop length of the animation: the CSS `animation-duration` wins, the
// duration requested through the API is an upper bound (the CSS value is
// clamped to it). The element's inline style wins over the <style> rule,
// as the CSS cascade demands.
int resolve_animation_duration(const html_to_image::AnimationSpec& spec,
                               const std::string& inline_style,
                               const litehtml::element::ptr& el,
                               int api_duration_ms) {
    std::string value = spec.duration_value;
    const std::string inline_duration =
        html_to_image::find_animation_duration(inline_style);
    if (!inline_duration.empty()) value = inline_duration;
    if (value.empty()) return api_duration_ms;
    value = resolve_var_references(el, value);
    int css_duration_ms = 0;
    if (!html_to_image::parse_time_ms(value, css_duration_ms)) return api_duration_ms;
    if (css_duration_ms <= 0) return api_duration_ms;
    if (api_duration_ms <= 0) return css_duration_ms;
    return std::min(api_duration_ms, css_duration_ms);
}

}  // namespace

int satoru_render_animation_to_converter_val(SatoruInstance* satoru, ImageConverterInstance* converter,
                                             val htmls, int width, int height, val options_val,
                                             int duration_ms, int fps) {
    if (!satoru || !converter) return 0;
    std::vector<std::string> html_vector = val_to_html_vector(htmls);
    if (html_vector.empty()) return 0;
    const std::string& html = html_vector[0];

    SatoruRenderOptions render_options;
    parse_satoru_options(render_options, options_val);

    html_to_image::AnimationSpec spec = html_to_image::parse_animation(html);
    // A block that is only animatable after a var() resolution is kept:
    // the document (and its custom properties) is needed to resolve it.
    if (!spec.valid && !spec.needs_resolution) return 0;

    // Ensure the document is laid out for exactly this input. After resource
    // resolution this is normally a no-op (the collect phase already built it).
    if (!satoru->document_ready_for(html, width, height, render_options.mediaType)) {
        satoru->collect_resources(html, width, height, render_options.mediaType);
    }
    if (!satoru->doc || !satoru->render_container || !satoru->doc->root() ||
        !satoru->doc->root_render()) {
        return 0;
    }

    // Resolve the animated element: selector from <style>, else inline style.
    litehtml::element::ptr target;
    if (!spec.selector.empty()) {
        target = satoru->doc->root()->select_one(spec.selector);
    }
    if (!target) {
        target = find_inline_animation_target(satoru->doc->root(),
                                              html_to_image::detail::to_lower(spec.name));
    }
    if (!target) return 0;

    const char* base_style_attr = target->get_attr("style");
    const std::string base_style = base_style_attr ? base_style_attr : "";

    // Resolve the var() references of the stop values (the document owns the
    // custom properties) and rebuild the animatable stops from them.
    resolve_animation_vars(spec, target);
    if (!spec.valid) return 0;

    // The loop length: the CSS `animation-duration` wins, the duration
    // requested through the API is an upper bound.
    const int duration =
        resolve_animation_duration(spec, base_style, target, duration_ms);

    // Colour stops are resolved through the document's colour resolution, so
    // named colours / rgb() / hsl() all work.
    const std::vector<html_to_image::ColorKeyframe> color_stops =
        resolve_color_stops(spec.color_stops);
    const std::vector<html_to_image::ColorKeyframe> background_color_stops =
        resolve_color_stops(spec.background_color_stops);

    const std::vector<html_to_image::FrameSample> schedule =
        html_to_image::build_frame_schedule(duration, fps);

    const uint64_t per_frame_bytes =
        (uint64_t)std::max(width, 1) * (uint64_t)std::max(height, 1) * 4;
    uint64_t total_bytes = 0;
    float last_opacity = std::numeric_limits<float>::quiet_NaN();
    std::string last_extra;
    int appended = 0;
    bool style_touched = false;

    for (const auto& sample : schedule) {
        if ((int)converter->frames.size() >= html_to_image::k_max_animation_frames) break;

        // Per-frame style overrides. Only the animated properties are written,
        // so the element keeps its static style for everything else.
        const bool has_opacity = !spec.stops.empty();
        const float opacity =
            has_opacity ? html_to_image::sample_opacity(spec, sample.progress) : 1.0f;
        std::string transform_value;
        const bool has_transform =
            html_to_image::sample_transform(spec, sample.progress, transform_value);
        const bool has_color = !color_stops.empty();
        const bool has_background_color = !background_color_stops.empty();

        std::string extra;
        if (has_transform) {
            extra += ";transform:";
            extra += transform_value;
        }
        if (has_color) {
            extra += ";color:";
            extra += html_to_image::format_rgba(
                html_to_image::sample_color(color_stops, sample.progress));
        }
        if (has_background_color) {
            extra += ";background-color:";
            extra += html_to_image::format_rgba(
                html_to_image::sample_color(background_color_stops, sample.progress));
        }

        // Dedupe at the style-value level (before any draw): an unchanged
        // value merges this frame's duration into the previous frame.
        const bool opacity_changed =
            !std::isnan(last_opacity) && std::fabs(opacity - last_opacity) >= 1e-3f;
        const bool extra_changed = (extra != last_extra);
        if (!converter->frames.empty() && !opacity_changed && !extra_changed) {
            converter->frames.back().duration += sample.duration_ms;
            continue;
        }

        if (total_bytes + per_frame_bytes > html_to_image::k_max_animation_total_pixel_bytes) break;

        std::string style = base_style;
        if (has_opacity) {
            style += ";opacity:";
            style += html_to_image::format_float(opacity);
        }
        style += extra;

        target->set_attr("style", style.c_str());
        target->refresh_styles();
        target->compute_styles(false);
        style_touched = true;
        // Paint-phase sync: re-collecting styled (now positioned at opacity<1
        // or carrying a transform) nodes keeps them in the positioned/stacking
        // pass, matching a full re-render without re-parsing.
        satoru->doc->root_render()->fetch_positioned();
        satoru->doc->root_render()->sort_positioned();

        SkBitmap bitmap;
        if (!renderDocumentToBitmap(satoru, width, height, render_options, bitmap)) break;

        total_bytes += per_frame_bytes;
        ConverterImageFrame frame;
        frame.bitmap = std::move(bitmap);
        frame.duration = sample.duration_ms;
        converter->frames.push_back(std::move(frame));
        last_opacity = opacity;
        last_extra = extra;
        appended++;
    }

    // Leave the document as it was found: the caller falls back to a normal
    // single-frame render when no frame was produced.
    if (style_touched) {
        target->set_attr("style", base_style.c_str());
        target->refresh_styles();
        target->compute_styles(false);
        satoru->doc->root_render()->fetch_positioned();
        satoru->doc->root_render()->sort_positioned();
    }

    if (converter->frames.empty()) return 0;
    converter->original_width = converter->frames[0].bitmap.width();
    converter->original_height = converter->frames[0].bitmap.height();
    converter->original_animation = converter->frames.size() > 1;
    converter->original_format = "png";
    return appended;
}
