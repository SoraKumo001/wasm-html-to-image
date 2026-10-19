#ifndef HTML_TO_IMAGE_CORE_ANIMATION_SAMPLER_H
#define HTML_TO_IMAGE_CORE_ANIMATION_SAMPLER_H

// Minimal animated-image sampling core.
//
// Scope (deliberately small):
//  - `@keyframes <name> { ... }` blocks are understood for `opacity`,
//    `transform` (translate/rotate/scale only) and `color` /
//    `background-color`.
//  - The animated element is bound by `animation-name: <name>` (or the
//    `animation` shorthand whose value contains `<name>`) in a <style> rule,
//    or in the element's inline `style` attribute (resolved by the caller).
//  - Stops are interpolated linearly. Per-keyframe easing, several animations
//    on one element, `animation-direction` and `animation-fill-mode` are out
//    of scope.
//  - Loop is fixed to "infinite" (one sampled cycle 0..duration).
//  - A `transform` whose function list differs between the stops cannot be
//    interpolated: such an element keeps its static transform (the whole
//    transform animation is dropped, the other properties still animate).
//
// This header is pure (no litehtml/Skia dependency) so it can be unit-tested
// and reused by the binding layer. It is header-only: no CMake source-list
// change is required.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace html_to_image {

// Default sampling: 15fps, at most 5 seconds (=> ~75 frames), and a hard
// cap on the accumulated raw-ARGB bytes so a long/heavy document cannot
// exhaust WASM memory (each frame keeps a full ARGB bitmap).
inline constexpr int k_default_animation_fps = 15;
inline constexpr int k_default_animation_max_ms = 5000;
inline constexpr int k_max_animation_frames = 75;  // 5s * 15fps
inline constexpr uint64_t k_max_animation_total_pixel_bytes =
    (uint64_t)256 * 1024 * 1024;  // ~256 MiB of ARGB frame data

struct OpacityKeyframe {
    float offset;   // 0..1
    float opacity;  // 0..1
};

// One argument of a transform function: the numeric value plus its unit
// ("px", "%", "deg" or "" for unitless numbers).
struct TransformArg {
    float value = 0.0f;
    std::string unit;
};

// A supported transform function (translate / rotate / scale) with a
// normalized argument count (translate/scale: 2, rotate: 1).
struct TransformFunction {
    std::string name;
    std::vector<TransformArg> args;
};

struct TransformKeyframe {
    float offset;                        // 0..1
    std::vector<TransformFunction> functions;
};

// A colour stop keeps the raw CSS value: turning it into components needs
// the document's colour resolution, which the binding layer provides.
struct ColorStop {
    float offset;  // 0..1
    std::string value;
};

// Resolved colour (8 bits per channel).
struct Rgba {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    uint8_t a = 255;
};

struct ColorKeyframe {
    float offset;  // 0..1
    Rgba color;
};

struct AnimationSpec {
    bool valid = false;
    std::string name;      // @keyframes name
    std::string selector;  // binding selector from a <style> rule ("" = inline only)
    std::vector<OpacityKeyframe> stops;             // opacity
    std::vector<TransformKeyframe> transform_stops; // transform
    std::vector<ColorStop> color_stops;             // color (raw values)
    std::vector<ColorStop> background_color_stops;  // background-color (raw values)
};

// One sampled frame: `progress` in [0,1) (loop semantics, end exclusive) and
// the display duration for that frame in ms. The final frame absorbs the
// remainder so the total equals the requested duration.
struct FrameSample {
    float progress;
    int duration_ms;
};

namespace detail {

inline std::string to_lower(std::string s) {
    for (auto& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

inline void skip_ws(const std::string& s, size_t& i) {
    while (i < s.size() && std::isspace((unsigned char)s[i])) ++i;
}

inline std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char)s[a])) ++a;
    while (b > a && std::isspace((unsigned char)s[b - 1])) --b;
    return s.substr(a, b - a);
}

// `open` must point at '{'. Returns the index of the matching '}'.
inline size_t find_matching_brace(const std::string& s, size_t open) {
    int depth = 0;
    for (size_t i = open; i < s.size(); ++i) {
        if (s[i] == '{') {
            depth++;
        } else if (s[i] == '}') {
            depth--;
            if (depth == 0) return i;
        }
    }
    return std::string::npos;
}

// Concatenated contents of every <style>...</style> block.
inline std::string collect_style_text(const std::string& html) {
    std::string css;
    const std::string lower = to_lower(html);
    size_t pos = 0;
    while (true) {
        size_t open = lower.find("<style", pos);
        if (open == std::string::npos) break;
        size_t gt = html.find('>', open);
        if (gt == std::string::npos) break;
        size_t close = lower.find("</style", gt);
        if (close == std::string::npos) break;
        css += html.substr(gt + 1, close - (gt + 1));
        css += "\n";
        pos = close + 1;
    }
    return css;
}

inline bool is_ident_char(char c) {
    return std::isalnum((unsigned char)c) || c == '-' || c == '_';
}

// Parse a CSS number at `i` (sign, digits, optional fraction/exponent).
// Returns false and leaves `i` untouched when there is no number.
inline bool parse_number(const std::string& s, size_t& i, float& out) {
    const size_t start = i;
    size_t p = i;
    if (p < s.size() && (s[p] == '+' || s[p] == '-')) ++p;
    bool digits = false;
    while (p < s.size() && std::isdigit((unsigned char)s[p])) {
        ++p;
        digits = true;
    }
    if (p < s.size() && s[p] == '.') {
        ++p;
        while (p < s.size() && std::isdigit((unsigned char)s[p])) {
            ++p;
            digits = true;
        }
    }
    if (!digits) return false;
    if (p < s.size() && (s[p] == 'e' || s[p] == 'E')) {
        const size_t save = p;
        ++p;
        if (p < s.size() && (s[p] == '+' || s[p] == '-')) ++p;
        bool exp_digits = false;
        while (p < s.size() && std::isdigit((unsigned char)s[p])) {
            ++p;
            exp_digits = true;
        }
        if (!exp_digits) p = save;
    }
    out = (float)std::strtod(s.substr(start, p - start).c_str(), nullptr);
    i = p;
    return true;
}

// Split a declaration block into (lower-cased property, value) pairs.
// Only top-level ';' and ':' separate, so values may contain functions,
// strings and nested blocks.
inline void split_declarations(const std::string& decls,
                               std::vector<std::pair<std::string, std::string>>& out) {
    std::string chunk;
    int depth = 0;
    char quote = 0;

    auto flush = [&]() {
        const std::string text = trim(chunk);
        chunk.clear();
        if (text.empty()) return;
        size_t colon = std::string::npos;
        int d = 0;
        for (size_t i = 0; i < text.size(); ++i) {
            if (text[i] == '(') {
                ++d;
                continue;
            }
            if (text[i] == ')') {
                if (d > 0) --d;
                continue;
            }
            if (text[i] == ':' && d == 0) {
                colon = i;
                break;
            }
        }
        if (colon == std::string::npos) return;
        const std::string prop = to_lower(trim(text.substr(0, colon)));
        const std::string value = trim(text.substr(colon + 1));
        if (prop.empty() || value.empty()) return;
        out.emplace_back(prop, value);
    };

    for (size_t i = 0; i < decls.size(); ++i) {
        const char c = decls[i];
        if (quote) {
            chunk += c;
            if (c == quote) quote = 0;
            continue;
        }
        if (c == '"' || c == '\'') {
            quote = c;
            chunk += c;
            continue;
        }
        if (c == '(') {
            ++depth;
            chunk += c;
            continue;
        }
        if (c == ')') {
            if (depth > 0) --depth;
            chunk += c;
            continue;
        }
        if (c == ';' && depth == 0) {
            flush();
            continue;
        }
        chunk += c;
    }
    flush();
}

// Split a value into whitespace/comma separated tokens.
inline std::vector<std::string> split_value_tokens(const std::string& value) {
    std::vector<std::string> out;
    std::string token;
    for (size_t i = 0; i < value.size(); ++i) {
        const char c = value[i];
        if (std::isspace((unsigned char)c) || c == ',') {
            if (!token.empty()) {
                out.push_back(token);
                token.clear();
            }
            continue;
        }
        token += c;
    }
    if (!token.empty()) out.push_back(token);
    return out;
}

// Parse one transform argument: a number plus an optional unit.
inline bool parse_transform_arg(const std::string& text, TransformArg& out) {
    const std::string t = trim(text);
    if (t.empty()) return false;
    size_t i = 0;
    float value = 0.0f;
    if (!parse_number(t, i, value)) return false;
    const size_t unit_start = i;
    while (i < t.size() && (std::isalpha((unsigned char)t[i]) || t[i] == '%')) ++i;
    if (i != t.size()) return false;  // trailing garbage
    out.value = value;
    out.unit = to_lower(t.substr(unit_start, i - unit_start));
    return true;
}

// Parse a `transform` value. Only translate/rotate/scale are understood; any
// other function (or an unparseable argument) invalidates the whole value so
// the caller can keep the element static.
inline bool parse_transform_value(const std::string& value,
                                  std::vector<TransformFunction>& out) {
    out.clear();
    size_t i = 0;
    while (true) {
        skip_ws(value, i);
        if (i >= value.size()) break;

        size_t name_start = i;
        while (i < value.size() && is_ident_char(value[i])) ++i;
        if (i == name_start) return false;
        const std::string name = to_lower(value.substr(name_start, i - name_start));
        skip_ws(value, i);
        if (i >= value.size() || value[i] != '(') return false;
        ++i;

        std::vector<std::string> raw_args;
        std::string arg;
        int depth = 0;
        bool closed = false;
        while (i < value.size()) {
            const char c = value[i];
            if (c == '(') {
                ++depth;
                arg += c;
                ++i;
                continue;
            }
            if (c == ')') {
                if (depth == 0) {
                    raw_args.push_back(trim(arg));
                    closed = true;
                    ++i;
                    break;
                }
                --depth;
                arg += c;
                ++i;
                continue;
            }
            if (c == ',' && depth == 0) {
                raw_args.push_back(trim(arg));
                arg.clear();
                ++i;
                continue;
            }
            arg += c;
            ++i;
        }
        if (!closed) return false;

        std::vector<TransformArg> args;
        for (const auto& raw : raw_args) {
            TransformArg arg_out;
            if (!parse_transform_arg(raw, arg_out)) return false;
            args.push_back(arg_out);
        }

        if (name == "translate") {
            if (args.empty() || args.size() > 2) return false;
            for (const auto& a : args) {
                if (a.unit != "px" && a.unit != "%") return false;
            }
            if (args.size() == 1) {
                TransformArg zero;
                zero.unit = args[0].unit;
                args.push_back(zero);
            }
        } else if (name == "rotate") {
            if (args.size() != 1) return false;
            const std::string& unit = args[0].unit;
            if (unit == "rad") {
                args[0].value = args[0].value * 180.0f / 3.14159265358979f;
            } else if (unit == "turn") {
                args[0].value = args[0].value * 360.0f;
            } else if (!unit.empty() && unit != "deg") {
                return false;
            }
            args[0].unit = "deg";
        } else if (name == "scale") {
            if (args.empty() || args.size() > 2) return false;
            for (const auto& a : args) {
                if (!a.unit.empty()) return false;
            }
            if (args.size() == 1) args.push_back(args[0]);
        } else {
            return false;  // unsupported transform function
        }

        TransformFunction fn;
        fn.name = name;
        fn.args = args;
        out.push_back(fn);
    }
    return !out.empty();
}

// The function list (names, order and argument units) must be identical in
// every stop, otherwise the values cannot be interpolated.
inline bool transform_signature_equal(const std::vector<TransformFunction>& a,
                                      const std::vector<TransformFunction>& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (a[i].name != b[i].name) return false;
        if (a[i].args.size() != b[i].args.size()) return false;
        for (size_t j = 0; j < a[i].args.size(); ++j) {
            if (a[i].args[j].unit != b[i].args[j].unit) return false;
        }
    }
    return true;
}

// Parse one `@keyframes` block starting at `at`. `end` receives the position
// just after the closing brace so the caller can continue scanning.
inline bool parse_keyframes_block(const std::string& css, size_t at, size_t kwlen,
                                  AnimationSpec& spec, size_t& end) {
    size_t i = at + kwlen;
    skip_ws(css, i);
    const size_t name_start = i;
    while (i < css.size() && is_ident_char(css[i])) ++i;
    const std::string name = css.substr(name_start, i - name_start);
    if (name.empty()) return false;
    skip_ws(css, i);
    if (i >= css.size() || css[i] != '{') return false;
    const size_t body_end = find_matching_brace(css, i);
    if (body_end == std::string::npos) return false;
    const std::string body = css.substr(i + 1, body_end - (i + 1));
    end = body_end + 1;

    spec.name = name;
    bool transform_invalid = false;

    size_t p = 0;
    while (p < body.size()) {
        skip_ws(body, p);
        if (p >= body.size()) break;
        const size_t sel_start = p;
        while (p < body.size() && body[p] != '{') ++p;
        if (p >= body.size()) break;
        const std::string sel = trim(body.substr(sel_start, p - sel_start));
        const size_t be = find_matching_brace(body, p);
        if (be == std::string::npos) break;
        const std::string decls = body.substr(p + 1, be - (p + 1));
        p = be + 1;

        float off = -1.0f;
        std::string first = sel;
        const size_t comma = first.find(',');
        if (comma != std::string::npos) first = trim(first.substr(0, comma));
        const std::string fl = to_lower(first);
        if (fl == "from") {
            off = 0.0f;
        } else if (fl == "to") {
            off = 1.0f;
        } else if (!first.empty() && first.back() == '%') {
            float pct = 0.0f;
            size_t k = 0;
            if (parse_number(first, k, pct) && k == first.size() - 1) {
                off = pct / 100.0f;
            }
        }
        if (off < 0.0f) continue;

        std::vector<std::pair<std::string, std::string>> props;
        split_declarations(decls, props);
        for (const auto& prop : props) {
            if (prop.first == "opacity") {
                size_t k = 0;
                float value = 0.0f;
                if (parse_number(prop.second, k, value)) {
                    // `opacity: 50%` is 0.5.
                    if (k < prop.second.size() && prop.second[k] == '%') value /= 100.0f;
                    spec.stops.push_back({off, value});
                }
            } else if (prop.first == "transform") {
                std::vector<TransformFunction> functions;
                if (!parse_transform_value(prop.second, functions)) {
                    transform_invalid = true;
                    continue;
                }
                TransformKeyframe stop;
                stop.offset = off;
                stop.functions = functions;
                spec.transform_stops.push_back(stop);
            } else if (prop.first == "color") {
                spec.color_stops.push_back({off, prop.second});
            } else if (prop.first == "background-color") {
                spec.background_color_stops.push_back({off, prop.second});
            }
        }
    }

    std::sort(spec.stops.begin(), spec.stops.end(),
              [](const OpacityKeyframe& a, const OpacityKeyframe& b) {
                  return a.offset < b.offset;
              });
    std::sort(spec.transform_stops.begin(), spec.transform_stops.end(),
              [](const TransformKeyframe& a, const TransformKeyframe& b) {
                  return a.offset < b.offset;
              });
    std::sort(spec.color_stops.begin(), spec.color_stops.end(),
              [](const ColorStop& a, const ColorStop& b) { return a.offset < b.offset; });
    std::sort(spec.background_color_stops.begin(), spec.background_color_stops.end(),
              [](const ColorStop& a, const ColorStop& b) { return a.offset < b.offset; });

    // A transform that cannot be interpolated (unsupported function or a
    // function list that differs between the stops) leaves the element
    // static: drop the whole transform animation.
    if (transform_invalid) {
        spec.transform_stops.clear();
    } else {
        for (size_t s = 1; s < spec.transform_stops.size(); ++s) {
            if (!transform_signature_equal(spec.transform_stops[0].functions,
                                           spec.transform_stops[s].functions)) {
                spec.transform_stops.clear();
                break;
            }
        }
    }

    spec.valid = !spec.stops.empty() || !spec.transform_stops.empty() ||
                 !spec.color_stops.empty() || !spec.background_color_stops.empty();
    return true;
}

// Collect every `@keyframes` block of the stylesheet.
inline void parse_all_keyframes(const std::string& css, std::vector<AnimationSpec>& out) {
    const std::string lower = to_lower(css);
    size_t pos = 0;
    while (pos < css.size()) {
        size_t at = lower.find("@keyframes", pos);
        size_t kwlen = 10;
        if (at == std::string::npos) {
            at = lower.find("@-webkit-keyframes", pos);
            kwlen = 18;
        }
        if (at == std::string::npos) break;
        AnimationSpec spec;
        size_t end = at + kwlen;
        if (!parse_keyframes_block(css, at, kwlen, spec, end)) {
            pos = at + kwlen;
            continue;
        }
        out.push_back(spec);
        pos = end;
    }
}

// Find the selector of the first qualified rule that binds `name`.
inline std::string find_animation_selector(const std::string& css, const std::string& name) {
    const std::string name_l = to_lower(name);
    size_t pos = 0;
    while (pos < css.size()) {
        skip_ws(css, pos);
        if (pos >= css.size()) break;
        if (css[pos] == '@') {
            size_t brace = css.find('{', pos);
            size_t semi = css.find(';', pos);
            if (brace == std::string::npos && semi == std::string::npos) break;
            if (semi != std::string::npos && (brace == std::string::npos || semi < brace)) {
                pos = semi + 1;
                continue;
            }
            size_t be = find_matching_brace(css, brace);
            if (be == std::string::npos) break;
            pos = be + 1;
            continue;
        }
        size_t brace = css.find('{', pos);
        if (brace == std::string::npos) break;
        const std::string sel = trim(css.substr(pos, brace - pos));
        size_t be = find_matching_brace(css, brace);
        if (be == std::string::npos) break;
        const std::string decls = to_lower(css.substr(brace + 1, be - (brace + 1)));
        pos = be + 1;
        if (sel.empty() || sel[0] == '@') continue;

        bool match = false;
        size_t an = decls.find("animation-name");
        if (an != std::string::npos) {
            size_t c = decls.find(':', an + 13);
            if (c != std::string::npos) {
                size_t v = c + 1;
                skip_ws(decls, v);
                size_t ve = v;
                while (ve < decls.size() && is_ident_char(decls[ve])) ++ve;
                if (decls.substr(v, ve - v) == name_l) match = true;
            }
        }
        if (!match) {
            size_t as = decls.find("animation");
            while (as != std::string::npos) {
                size_t after = as + 9;
                if (after < decls.size() && is_ident_char(decls[after])) {
                    as = decls.find("animation", after);
                    continue;
                }
                size_t w = after;
                skip_ws(decls, w);
                if (w < decls.size() && decls[w] == ':') {
                    size_t ve = decls.find(';', w);
                    if (ve == std::string::npos) ve = decls.size();
                    const std::string value = decls.substr(w + 1, ve - (w + 1));
                    for (const auto& token : split_value_tokens(value)) {
                        if (token == name_l) {
                            match = true;
                            break;
                        }
                    }
                }
                break;
            }
        }
        if (match) return sel;
    }
    return "";
}

}  // namespace detail

// Compact decimal formatting (at most 4 fraction digits, no trailing zeros).
inline std::string format_float(float value) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.4f", (double)value);
    std::string s(buf);
    if (s.find('.') != std::string::npos) {
        while (!s.empty() && s.back() == '0') s.pop_back();
        if (!s.empty() && s.back() == '.') s.pop_back();
    }
    if (s == "-0") s = "0";
    return s;
}

// CSS colour text for a resolved colour.
inline std::string format_rgba(const Rgba& color) {
    if (color.a == 255) {
        char buf[16];
        std::snprintf(buf, sizeof(buf), "#%02x%02x%02x", color.r, color.g, color.b);
        return buf;
    }
    char buf[48];
    std::snprintf(buf, sizeof(buf), "rgba(%d,%d,%d,%.3f)", color.r, color.g, color.b,
                  (double)color.a / 255.0);
    return buf;
}

// Parse the document's @keyframes animation that is bound to an element.
// The first block bound by a <style> rule wins; otherwise the first block is
// returned and the caller resolves an inline-style binding by name.
inline AnimationSpec parse_animation(const std::string& html) {
    AnimationSpec result;
    const std::string css = detail::collect_style_text(html);
    if (css.empty()) return result;

    std::vector<AnimationSpec> specs;
    detail::parse_all_keyframes(css, specs);

    for (const auto& candidate : specs) {
        if (!candidate.valid) continue;
        AnimationSpec spec = candidate;
        spec.selector = detail::find_animation_selector(css, spec.name);
        if (!spec.selector.empty()) return spec;
    }
    for (const auto& candidate : specs) {
        if (!candidate.valid) continue;
        AnimationSpec spec = candidate;
        spec.selector = detail::find_animation_selector(css, spec.name);
        return spec;  // inline-style binding fallback
    }
    return result;
}

// Linear interpolation over the (sorted) keyframe stops, clamped at both ends.
inline float sample_opacity(const AnimationSpec& spec, float progress) {
    if (spec.stops.empty()) return 1.0f;
    if (progress <= spec.stops.front().offset) return spec.stops.front().opacity;
    if (progress >= spec.stops.back().offset) return spec.stops.back().opacity;
    for (size_t i = 1; i < spec.stops.size(); ++i) {
        if (progress <= spec.stops[i].offset) {
            const auto& a = spec.stops[i - 1];
            const auto& b = spec.stops[i];
            const float span = b.offset - a.offset;
            if (span <= 0.0f) return b.opacity;
            const float t = (progress - a.offset) / span;
            return a.opacity + (b.opacity - a.opacity) * t;
        }
    }
    return spec.stops.back().opacity;
}

// Interpolate the transform stops into a CSS `transform` value.
// Returns false when the element must keep its static transform (no
// transform stops, or a function list that differs between the stops).
inline bool sample_transform(const AnimationSpec& spec, float progress, std::string& out) {
    out.clear();
    const auto& stops = spec.transform_stops;
    if (stops.empty()) return false;

    size_t index = 0;
    float t = 0.0f;
    if (progress <= stops.front().offset) {
        index = 0;
    } else if (progress >= stops.back().offset) {
        index = stops.size() - 1;
    } else {
        for (size_t i = 1; i < stops.size(); ++i) {
            if (progress <= stops[i].offset) {
                const float span = stops[i].offset - stops[i - 1].offset;
                index = i - 1;
                t = span > 0.0f ? (progress - stops[i - 1].offset) / span : 0.0f;
                break;
            }
        }
    }

    const auto& a = stops[index].functions;
    const auto& b = (index + 1 < stops.size()) ? stops[index + 1].functions : a;
    for (size_t f = 0; f < a.size(); ++f) {
        if (f) out += " ";
        out += a[f].name;
        out += "(";
        for (size_t j = 0; j < a[f].args.size(); ++j) {
            if (j) out += ", ";
            const float value =
                a[f].args[j].value + (b[f].args[j].value - a[f].args[j].value) * t;
            out += format_float(value);
            out += a[f].args[j].unit;
        }
        out += ")";
    }
    return true;
}

// Linear interpolation over resolved colour stops, clamped at both ends.
inline Rgba sample_color(const std::vector<ColorKeyframe>& stops, float progress) {
    Rgba out;
    if (stops.empty()) return out;

    size_t index = 0;
    float t = 0.0f;
    if (progress <= stops.front().offset) {
        index = 0;
    } else if (progress >= stops.back().offset) {
        index = stops.size() - 1;
    } else {
        for (size_t i = 1; i < stops.size(); ++i) {
            if (progress <= stops[i].offset) {
                const float span = stops[i].offset - stops[i - 1].offset;
                index = i - 1;
                t = span > 0.0f ? (progress - stops[i - 1].offset) / span : 0.0f;
                break;
            }
        }
    }

    const Rgba& a = stops[index].color;
    const Rgba& b = (index + 1 < stops.size()) ? stops[index + 1].color : a;
    auto mix = [&](uint8_t from, uint8_t to) -> uint8_t {
        const double value = (double)from + ((double)to - (double)from) * (double)t;
        return (uint8_t)std::lround(value < 0.0 ? 0.0 : (value > 255.0 ? 255.0 : value));
    };
    out.r = mix(a.r, b.r);
    out.g = mix(a.g, b.g);
    out.b = mix(a.b, b.b);
    out.a = mix(a.a, b.a);
    return out;
}

// Fixed-interval sampling with boundary snap: one cycle 0..duration, end
// exclusive (loop wraps progress 1 -> 0). Frame count is derived from
// duration*fps and clamped to [2, k_max_animation_frames]; the last frame
// absorbs the remainder so the durations sum to exactly `duration_ms`.
inline std::vector<FrameSample> build_frame_schedule(int duration_ms, int fps) {
    std::vector<FrameSample> out;
    if (duration_ms <= 0) duration_ms = 1000;
    if (fps <= 0) fps = k_default_animation_fps;
    if (duration_ms > k_default_animation_max_ms) duration_ms = k_default_animation_max_ms;

    int count = (int)std::lround((double)duration_ms * (double)fps / 1000.0);
    if (count < 2) count = 2;
    if (count > k_max_animation_frames) count = k_max_animation_frames;
    int per = duration_ms / count;
    if (per < 1) per = 1;

    out.reserve((size_t)count);
    for (int i = 0; i < count; ++i) {
        FrameSample fs;
        fs.progress = (float)i / (float)count;
        fs.duration_ms = (i == count - 1) ? (duration_ms - per * (count - 1)) : per;
        if (fs.duration_ms < 1) fs.duration_ms = 1;
        out.push_back(fs);
    }
    return out;
}

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_CORE_ANIMATION_SAMPLER_H
