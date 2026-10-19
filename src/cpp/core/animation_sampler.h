#ifndef HTML_TO_IMAGE_CORE_ANIMATION_SAMPLER_H
#define HTML_TO_IMAGE_CORE_ANIMATION_SAMPLER_H

// Minimal animated-image sampling core (vertical slice, opacity only).
//
// Scope (deliberately small):
//  - Only `@keyframes <name> { ... opacity: <v> ... }` blocks are understood.
//  - The animated element is bound by `animation-name: <name>` (or the
//    `animation` shorthand whose value contains `<name>`) in a <style> rule,
//    or in the element's inline `style` attribute (resolved by the caller).
//  - Only `opacity` is sampled; transform/color/filter are out of scope.
//  - Loop is fixed to "infinite" (one sampled cycle 0..duration).
//
// This header is pure (no litehtml/Skia dependency) so it can be unit-tested
// and reused by the binding layer. It is header-only: no CMake source-list
// change is required.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <string>
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

struct AnimationSpec {
    bool valid = false;
    std::string name;      // @keyframes name
    std::string selector;  // binding selector from a <style> rule ("" = inline only)
    std::vector<OpacityKeyframe> stops;  // sorted by offset
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

// Parse the first @keyframes block. Returns name + opacity stops.
inline bool parse_keyframes(const std::string& css, std::string& name,
                            std::vector<OpacityKeyframe>& stops) {
    const std::string lower = to_lower(css);
    size_t at = lower.find("@keyframes");
    size_t kwlen = 10;
    if (at == std::string::npos) {
        at = lower.find("@-webkit-keyframes");
        kwlen = 18;
    }
    if (at == std::string::npos) return false;

    size_t i = at + kwlen;
    skip_ws(css, i);
    size_t ns = i;
    while (i < css.size() && is_ident_char(css[i])) ++i;
    name = css.substr(ns, i - ns);
    skip_ws(css, i);
    if (i >= css.size() || css[i] != '{') return false;
    size_t body_end = find_matching_brace(css, i);
    if (body_end == std::string::npos) return false;
    const std::string body = css.substr(i + 1, body_end - (i + 1));

    size_t p = 0;
    while (p < body.size()) {
        skip_ws(body, p);
        if (p >= body.size()) break;
        size_t sel_start = p;
        while (p < body.size() && body[p] != '{') ++p;
        if (p >= body.size()) break;
        const std::string sel = trim(body.substr(sel_start, p - sel_start));
        size_t be = find_matching_brace(body, p);
        if (be == std::string::npos) break;
        const std::string decls = body.substr(p + 1, be - (p + 1));
        p = be + 1;

        float off = -1.0f;
        std::string first = sel;
        size_t comma = first.find(',');
        if (comma != std::string::npos) first = trim(first.substr(0, comma));
        const std::string fl = to_lower(first);
        if (fl == "from") {
            off = 0.0f;
        } else if (fl == "to") {
            off = 1.0f;
        } else if (!first.empty() && first.back() == '%') {
            try {
                off = std::stof(first.substr(0, first.size() - 1)) / 100.0f;
            } catch (...) {
                off = -1.0f;
            }
        }
        if (off < 0.0f) continue;

        const std::string dl = to_lower(decls);
        size_t od = dl.find("opacity");
        if (od == std::string::npos) continue;
        size_t c = decls.find(':', od + 7);
        if (c == std::string::npos) continue;
        size_t v = c + 1;
        skip_ws(decls, v);
        size_t ve = v;
        while (ve < decls.size() &&
               (std::isdigit((unsigned char)decls[ve]) || decls[ve] == '.' || decls[ve] == '-' ||
                decls[ve] == '+' || decls[ve] == 'e' || decls[ve] == 'E')) {
            ++ve;
        }
        try {
            stops.push_back({off, std::stof(decls.substr(v, ve - v))});
        } catch (...) {
            // ignore malformed value
        }
    }

    std::sort(stops.begin(), stops.end(),
              [](const OpacityKeyframe& a, const OpacityKeyframe& b) { return a.offset < b.offset; });
    return !stops.empty();
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
                    if (decls.substr(w + 1, ve - (w + 1)).find(name_l) != std::string::npos) match = true;
                }
                break;
            }
        }
        if (match) return sel;
    }
    return "";
}

}  // namespace detail

// Parse the first opacity animation found in the document's <style> blocks.
inline AnimationSpec parse_opacity_animation(const std::string& html) {
    AnimationSpec spec;
    const std::string css = detail::collect_style_text(html);
    if (css.empty()) return spec;
    std::vector<OpacityKeyframe> stops;
    std::string name;
    if (!detail::parse_keyframes(css, name, stops)) return spec;
    spec.name = name;
    spec.stops = stops;
    spec.selector = detail::find_animation_selector(css, name);
    spec.valid = true;
    return spec;
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
