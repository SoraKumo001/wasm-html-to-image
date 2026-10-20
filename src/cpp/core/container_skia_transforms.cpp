// P2a責務: transform + layer(opacity/blend) (詳細は下記 責務 ブロック)。
#include <cmath>
#include <cctype>
#include <algorithm>
#include <optional>
#include <string>

#include "bridge/magic_tags.h"
#include "container_skia.h"
#include "container_skia_helpers.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathMeasure.h"
#include "include/core/SkRect.h"
#include "include/utils/SkParsePath.h"
#include "libs/litehtml/include/litehtml/css_length.h"
#include "libs/litehtml/include/litehtml/css_parser.h"

// ────────────────────────────────────────────────────────────────────────────
// 責務 (P2a): transform + layer(opacity/blend) (状態は m_transform/m_paint へ分離済み)
// 行列の単関数計算は container_skia_helpers.h の compute_transform_matrix を参照。
// 振る舞い不変・新規throwなし。
// ────────────────────────────────────────────────────────────────────────────
// Layer (opacity + blend mode)
// ────────────────────────────────────────────────────────────────────────────

void container_skia::push_layer(litehtml::uint_ptr hdc, float opacity, litehtml::blend_mode bm) {
    push_layer_impl(opacity, bm, nullptr);
}

void container_skia::push_layer(litehtml::uint_ptr hdc, float opacity, litehtml::blend_mode bm,
                                const litehtml::position& bounds) {
    // The tagged (SVG) output keeps the full-size layer markers.
    if (m_tagging) {
        push_layer_impl(opacity, bm, nullptr);
        return;
    }
    const SkRect rect = SkRect::MakeXYWH((float)bounds.x, (float)bounds.y, (float)bounds.width,
                                         (float)bounds.height);
    push_layer_impl(opacity, bm, &rect);
}

void container_skia::push_layer_impl(float opacity, litehtml::blend_mode bm, const SkRect* bounds) {
    m_paint.opacityStack.push_back(opacity);
    if (m_canvas) {
        flush();

        SkBlendMode sk_bm = to_skia_blend_mode(bm);

        if (m_tagging) {
            SkPaint p;
            if (bm == litehtml::blend_mode_normal) {
                p.setColor(make_magic_color(satoru::MagicTag::LayerPush, (int)(opacity * 255.0f)));
            } else {
                // Pack opacity (8-bit) and blend mode (4-bit) into index
                int packed = ((int)(opacity * 255.0f) << 4) | ((int)bm & 0x0F);
                p.setColor(make_magic_color(satoru::MagicTag::LayerPushBlend, packed));
            }
            SkRect rect;
            if (!m_clip.clips.empty()) {
                rect = SkRect::MakeXYWH(
                    (float)m_clip.clips.back().first.x, (float)m_clip.clips.back().first.y,
                    (float)m_clip.clips.back().first.width, (float)m_clip.clips.back().first.height);
            } else {
                rect = SkRect::MakeWH((float)m_width, (float)m_height);
            }
            m_canvas->drawRect(rect, p);
        } else if (opacity < 1.0f || sk_bm != SkBlendMode::kSrcOver) {
            SkPaint paint;
            paint.setAlphaf(opacity);
            paint.setBlendMode(sk_bm);
            // A bounded layer only allocates / composites that area instead of the whole canvas.
            m_canvas->saveLayer(bounds, &paint);
        } else {
            m_canvas->save();
        }
    }
}

void container_skia::pop_layer(litehtml::uint_ptr hdc) {
    if (m_paint.opacityStack.empty()) return;
    float opacity = m_paint.opacityStack.back();
    m_paint.opacityStack.pop_back();

    if (m_canvas) {
        flush();
        if (m_tagging) {
            SkPaint p;
            p.setColor(make_magic_color(satoru::MagicTag::LayerPop));
            SkRect rect;
            if (!m_clip.clips.empty()) {
                rect = SkRect::MakeXYWH(
                    (float)m_clip.clips.back().first.x, (float)m_clip.clips.back().first.y,
                    (float)m_clip.clips.back().first.width, (float)m_clip.clips.back().first.height);
            } else {
                rect = SkRect::MakeWH((float)m_width, (float)m_height);
            }
            m_canvas->drawRect(rect, p);
        } else {
            m_canvas->restore();
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// CSS transform
// ────────────────────────────────────────────────────────────────────────────

void container_skia::push_transform(litehtml::uint_ptr hdc,
                                    const litehtml::css_token_vector& transform,
                                    const litehtml::css_token_vector& origin,
                                    const litehtml::position& pos) {
    if (!m_canvas) return;
    flush();

    m_canvas->save();
    m_transform.depth++;

    float ox = pos.x + pos.width * 0.5f;
    float oy = pos.y + pos.height * 0.5f;

    if (!origin.empty()) {
        int n = 0;
        for (const auto& tok : origin) {
            if (tok.type == litehtml::WHITESPACE) continue;
            litehtml::css_length len;
            if (len.from_token(tok, litehtml::f_length_percentage,
                               "left;right;top;bottom;center")) {
                if (n == 0)
                    ox = len.calc_percent(pos.width) + pos.x;
                else if (n == 1)
                    oy = len.calc_percent(pos.height) + pos.y;
                n++;
            }
        }
    }

    m_canvas->translate(ox, oy);

    for (const auto& tok : transform) {
        if (tok.type == litehtml::CV_FUNCTION) {
            std::string name = litehtml::lowcase(tok.name);
            std::vector<float> vals;
            for (const auto& arg_tok : tok.value) {
                if (arg_tok.type == litehtml::NUMBER || arg_tok.type == litehtml::DIMENSION ||
                    arg_tok.type == litehtml::PERCENTAGE) {
                    float v = arg_tok.n.number;
                    if (arg_tok.type == litehtml::PERCENTAGE) {
                        if (name.find("translate") != std::string::npos) {
                            v = v * (vals.empty() ? pos.width : pos.height) / 100.0f;
                        } else {
                            v /= 100.0f;
                        }
                    }
                    if (arg_tok.type == litehtml::DIMENSION &&
                        (litehtml::lowcase(arg_tok.unit) == "rad" ||
                         litehtml::lowcase(arg_tok.unit) == "turn")) {
                        if (litehtml::lowcase(arg_tok.unit) == "rad") {
                            v = v * 180.0f / 3.14159265f;
                        } else if (litehtml::lowcase(arg_tok.unit) == "turn") {
                            v = v * 360.0f;
                        }
                    }
                    vals.push_back(v);
                }
            }

            if (name == "matrix" && vals.size() >= 6) {
                SkMatrix m;
                m.setAll(vals[0], vals[2], vals[4], vals[1], vals[3], vals[5], 0, 0, 1);
                m_canvas->concat(m);
            } else if (name == "translate" || name == "translate3d") {
                m_canvas->translate(vals.size() > 0 ? vals[0] : 0, vals.size() > 1 ? vals[1] : 0);
            } else if (name == "translatex") {
                m_canvas->translate(vals.size() > 0 ? vals[0] : 0, 0);
            } else if (name == "translatey") {
                m_canvas->translate(0, vals.size() > 0 ? vals[0] : 0);
            } else if (name == "scale" || name == "scale3d") {
                float sx = vals.size() > 0 ? vals[0] : 1;
                float sy = vals.size() > 1 ? vals[1] : sx;
                m_canvas->scale(sx, sy);
            } else if (name == "scalex") {
                m_canvas->scale(vals.size() > 0 ? vals[0] : 1, 1);
            } else if (name == "scaley") {
                m_canvas->scale(1, vals.size() > 0 ? vals[0] : 1);
            } else if (name == "rotate" || name == "rotatez") {
                if (!vals.empty()) m_canvas->rotate(vals[0]);
            } else if (name == "skew" && !vals.empty()) {
                float kx = vals[0];
                float ky = vals.size() > 1 ? vals[1] : 0;
                m_canvas->skew(tanf(kx * 3.14159f / 180.0f), tanf(ky * 3.14159f / 180.0f));
            } else if (name == "skewx" && !vals.empty()) {
                m_canvas->skew(tanf(vals[0] * 3.14159f / 180.0f), 0);
            } else if (name == "skewy" && !vals.empty()) {
                m_canvas->skew(0, tanf(vals[0] * 3.14159f / 180.0f));
            }
        }
    }

    m_canvas->translate(-ox, -oy);
}

void container_skia::pop_transform(litehtml::uint_ptr hdc) {
    if (m_transform.depth <= 0) return;
    m_transform.depth--;

    if (m_canvas) {
        flush();
        m_canvas->restore();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// CSS Motion Path (offset-path / offset-distance / offset-rotate / offset-anchor
// / offset-position). Geometry is resolved with Skia so the layout side only has
// to forward the raw component values (mirrors the push_clip_path split).
//
// Coordinate model: the offset path lives in the containing block's coordinate
// system (ref_box, absolute output pixels). The element's border box (box) is
// translated so that its anchor point lands on the resolved path position and
// rotated by the resolved offset-rotate angle. <coord-box> is accepted but the
// default border-box reference is always used. url() references are out of scope.
// ────────────────────────────────────────────────────────────────────────────
namespace {

bool offset_tok_ws(const litehtml::css_token& t) { return t.type == litehtml::WHITESPACE; }

float offset_angle_deg(const litehtml::css_token& t) {
    if (t.type == litehtml::NUMBER) return t.n.number;
    if (t.type == litehtml::DIMENSION) {
        std::string u = litehtml::lowcase(t.unit);
        float v = t.n.number;
        if (u == "rad") return v * 180.0f / 3.14159265358979f;
        if (u == "turn") return v * 360.0f;
        if (u == "grad") return v * 0.9f;
        return v;  // deg (or unitless)
    }
    return 0.0f;
}

// Resolve a <position> token list against `box`; result is absolute output space.
bool resolve_position_tokens(const litehtml::css_token_vector& tokens,
                             const litehtml::position& box, float& out_x, float& out_y) {
    float x = box.width * 0.5f, y = box.height * 0.5f;
    bool x_set = false, y_set = false;
    bool any = false;
    for (const auto& t : tokens) {
        if (offset_tok_ws(t)) continue;
        any = true;
        if (t.type == litehtml::IDENT) {
            std::string id = litehtml::lowcase(t.ident());
            if (id == "left") {
                x = 0;
                x_set = true;
            } else if (id == "right") {
                x = box.width;
                x_set = true;
            } else if (id == "top") {
                y = 0;
                y_set = true;
            } else if (id == "bottom") {
                y = box.height;
                y_set = true;
            } else if (id == "center") {
                if (!x_set) {
                    x = box.width * 0.5f;
                    x_set = true;
                }
                if (!y_set) {
                    y = box.height * 0.5f;
                    y_set = true;
                }
            }
        } else if (t.type == litehtml::NUMBER || t.type == litehtml::PERCENTAGE ||
                   t.type == litehtml::DIMENSION) {
            litehtml::css_length len;
            if (len.from_token(t, litehtml::f_length_percentage)) {
                bool pct = len.units() == litehtml::css_units_percentage;
                if (!x_set) {
                    x = pct ? (float)(box.width * len.val() / 100.0f) : len.val();
                    x_set = true;
                } else if (!y_set) {
                    y = pct ? (float)(box.height * len.val() / 100.0f) : len.val();
                    y_set = true;
                }
            }
        }
    }
    out_x = box.x + x;
    out_y = box.y + y;
    return any;
}

bool tokens_have_ident(const litehtml::css_token_vector& tokens, const std::string& name) {
    for (const auto& t : tokens) {
        if (t.type == litehtml::IDENT && litehtml::lowcase(t.ident()) == name) return true;
    }
    return false;
}

const litehtml::css_token* first_function(const litehtml::css_token_vector& tokens) {
    for (const auto& t : tokens) {
        if (t.type == litehtml::CV_FUNCTION) return &t;
    }
    return nullptr;
}

// Extract the SVG path string argument of path("...") / path('...').
std::string extract_path_string(const litehtml::css_token& fn) {
    for (const auto& t : fn.value) {
        if (t.type == litehtml::STRING) return t.str;
        if (t.type == litehtml::URL) return t.str;
    }
    // Fall back to the raw representation with surrounding quotes stripped.
    std::string repr = litehtml::get_repr(fn.value);
    if (repr.size() >= 2 && (repr.front() == '"' || repr.front() == '\'') &&
        repr.back() == repr.front())
        return repr.substr(1, repr.size() - 2);
    return repr;
}

}  // anonymous namespace

void container_skia::push_offset_path(litehtml::uint_ptr hdc,
                                      const litehtml::css_token_vector& path,
                                      const litehtml::css_token_vector& offset_pos,
                                      const litehtml::css_token_vector& distance,
                                      const litehtml::css_token_vector& rotate,
                                      const litehtml::css_token_vector& anchor,
                                      const litehtml::css_token_vector& transform_origin,
                                      const litehtml::position& ref_box,
                                      const litehtml::position& box) {
    if (!m_canvas || path.empty()) return;
    // offset-path: none => no offset transform.
    if (!first_function(path) && tokens_have_ident(path, "none")) return;

    flush();

    const float bx = (float)box.x, by = (float)box.y;
    const float bw = (float)box.width, bh = (float)box.height;
    const float rx = (float)ref_box.x, ry = (float)ref_box.y;
    const float rw = (float)ref_box.width, rh = (float)ref_box.height;

    // ── Resolve the path point and tangent ──
    float px = bx, py = by;       // path position (absolute)
    float tx = 1.0f, ty = 0.0f;   // path tangent
    float total_len = 0.0f;
    bool path_closed = false;

    const litehtml::css_token* fn = first_function(path);
    std::string fname = fn ? litehtml::lowcase(fn->name) : std::string();

    // offset-distance -> requested distance.
    float dist_val = 0.0f;
    bool dist_is_pct = false;
    for (const auto& t : distance) {
        if (offset_tok_ws(t)) continue;
        litehtml::css_length len;
        if (len.from_token(t, litehtml::f_length_percentage)) {
            dist_is_pct = len.units() == litehtml::css_units_percentage;
            dist_val = len.val();
        }
        break;
    }

    if (fname == "ray") {
        // Angle: first number/angle token before `at`.
        float angle_deg = 0.0f;
        bool angle_found = false;
        std::string size_kind = "closest-side";
        bool have_contain = false;
        litehtml::css_token_vector at_tokens;
        bool in_at = false;
        for (const auto& t : fn->value) {
            if (offset_tok_ws(t)) continue;
            if (t.type == litehtml::IDENT) {
                std::string id = litehtml::lowcase(t.ident());
                if (id == "at") {
                    in_at = true;
                    continue;
                }
                if (in_at) {
                    at_tokens.push_back(t);
                    continue;
                }
                if (id == "closest-side" || id == "closest-corner" || id == "farthest-side" ||
                    id == "farthest-corner" || id == "sides")
                    size_kind = id;
                else if (id == "contain")
                    have_contain = true;
            } else if (t.type == litehtml::NUMBER || t.type == litehtml::DIMENSION) {
                if (in_at) {
                    at_tokens.push_back(t);
                } else if (!angle_found) {
                    angle_deg = offset_angle_deg(t);
                    angle_found = true;
                }
            } else if (t.type == litehtml::PERCENTAGE) {
                if (in_at) at_tokens.push_back(t);
            }
        }

        // Ray origin: `at <position>` > offset-position > center of ref box.
        float ox, oy;
        if (!at_tokens.empty()) {
            resolve_position_tokens(at_tokens, ref_box, ox, oy);
        } else if (tokens_have_ident(offset_pos, "auto")) {
            ox = bx;  // auto => top-left of the element's own box
            oy = by;
        } else if (offset_pos.empty() || tokens_have_ident(offset_pos, "normal")) {
            ox = rx + rw * 0.5f;
            oy = ry + rh * 0.5f;
        } else {
            resolve_position_tokens(offset_pos, ref_box, ox, oy);
        }

        float rad = angle_deg * 3.14159265358979f / 180.0f;
        float dirx = sinf(rad);
        float diry = -cosf(rad);  // 0deg = up, positive = clockwise

        // Ray length from <ray-size>.
        float cand[8];
        int ncand = 0;
        auto add_cand = [&](float t) {
            if (t >= 0.0f && ncand < 8) cand[ncand++] = t;
        };
        if (dirx > 1e-6f) add_cand((rx + rw - ox) / dirx);
        if (dirx < -1e-6f) add_cand((rx - ox) / dirx);
        if (diry > 1e-6f) add_cand((ry + rh - oy) / diry);
        if (diry < -1e-6f) add_cand((ry - oy) / diry);
        float ray_len = std::max(bw, bh);
        if (size_kind == "closest-side") {
            if (ncand > 0) {
                ray_len = cand[0];
                for (int i = 1; i < ncand; i++) ray_len = std::min(ray_len, cand[i]);
            }
        } else if (size_kind == "farthest-side") {
            if (ncand > 0) {
                ray_len = cand[0];
                for (int i = 1; i < ncand; i++) ray_len = std::max(ray_len, cand[i]);
            }
        } else if (size_kind == "sides") {
            bool inside = ox >= rx && ox <= rx + rw && oy >= ry && oy <= ry + rh;
            if (inside && ncand > 0) {
                ray_len = cand[0];
                for (int i = 1; i < ncand; i++) ray_len = std::min(ray_len, cand[i]);
            } else {
                ray_len = 0.0f;
            }
        } else {  // closest-corner / farthest-corner
            float corners[4][2] = {{rx, ry}, {rx + rw, ry}, {rx, ry + rh}, {rx + rw, ry + rh}};
            float best = 0.0f;
            for (int i = 0; i < 4; i++) {
                float dx = corners[i][0] - ox, dy = corners[i][1] - oy;
                float d = sqrtf(dx * dx + dy * dy);
                if (i == 0 || (size_kind == "closest-corner" ? d < best : d > best)) best = d;
            }
            ray_len = best;
        }
        if (have_contain) {
            ray_len = std::max(0.0f, ray_len - std::max(bw, bh) * 0.5f);
        }
        total_len = ray_len;

        float used = dist_is_pct ? dist_val / 100.0f * total_len : dist_val;
        if (have_contain) used = std::max(0.0f, std::min(used, total_len));
        px = ox + dirx * used;
        py = oy + diry * used;
        tx = dirx;
        ty = diry;
    } else {
        // path() / basic-shape: build an absolute SkPath.
        SkPath skpath;
        if (fname == "path") {
            std::string data = extract_path_string(*fn);
            if (auto parsed = SkParsePath::FromSVGString(data.c_str())) {
                skpath = *parsed;
                skpath = skpath.makeOffset(rx, ry);
                // Closed only when the final command is a closepath.
                std::string trimmed = data;
                while (!trimmed.empty() && isspace((unsigned char)trimmed.back())) trimmed.pop_back();
                path_closed = !trimmed.empty() &&
                              (trimmed.back() == 'z' || trimmed.back() == 'Z');
            }
        } else {
            skpath = container_skia::parse_clip_path(path, ref_box);
            path_closed = true;  // basic shapes are closed loops
        }
        if (skpath.isEmpty()) return;

        SkPathMeasure measure(skpath, false);
        total_len = measure.getLength();
        float used = dist_is_pct ? dist_val / 100.0f * total_len : dist_val;
        if (path_closed && total_len > 0.0f) {
            used = fmodf(used, total_len);
            if (used < 0.0f) used += total_len;
        } else {
            used = std::max(0.0f, std::min(used, total_len));
        }
        SkPoint pos;
        SkVector tan;
        if (measure.getPosTan(used, &pos, &tan)) {
            px = pos.fX;
            py = pos.fY;
            tx = tan.fX;
            ty = tan.fY;
        } else {
            px = bx;
            py = by;
        }
    }

    // ── offset-rotate ──
    // `auto` (default) follows the path tangent, `reverse` follows it backwards and
    // a plain <angle> is absolute. An explicit angle wins over the tangent even when
    // the angle is 0 (`offset-rotate: 0deg` must not rotate at all).
    std::string rot_mode;
    float rot_extra = 0.0f;
    bool have_angle = false;
    for (const auto& t : rotate) {
        if (offset_tok_ws(t)) continue;
        if (t.type == litehtml::IDENT) {
            std::string id = litehtml::lowcase(t.ident());
            if (id == "auto") rot_mode = "auto";
            else if (id == "reverse") rot_mode = "reverse";
        } else if (t.type == litehtml::NUMBER || t.type == litehtml::DIMENSION) {
            rot_extra += offset_angle_deg(t);
            have_angle = true;
        }
    }
    if (rot_mode.empty() && !have_angle) rot_mode = "auto";
    float tangent_deg = atan2f(ty, tx) * 180.0f / 3.14159265358979f;
    float angle = rot_extra;
    if (rot_mode == "auto") angle += tangent_deg;
    else if (rot_mode == "reverse") angle += tangent_deg + 180.0f;

    // ── offset-anchor (auto => transform-origin, default 50% 50%) ──
    float ax, ay;
    bool anchor_auto = anchor.empty() || tokens_have_ident(anchor, "auto");
    if (anchor_auto) {
        if (!resolve_position_tokens(transform_origin, box, ax, ay)) {
            ax = bx + bw * 0.5f;
            ay = by + bh * 0.5f;
        }
    } else if (!resolve_position_tokens(anchor, box, ax, ay)) {
        ax = bx + bw * 0.5f;
        ay = by + bh * 0.5f;
    }

    // Move the anchor onto the path position and rotate about it.
    m_canvas->save();
    m_transform.offsetDepth++;
    m_canvas->translate(px, py);
    if (angle != 0.0f) m_canvas->rotate(angle);
    m_canvas->translate(-ax, -ay);
}

void container_skia::pop_offset_path(litehtml::uint_ptr hdc) {
    if (m_transform.offsetDepth <= 0) return;
    m_transform.offsetDepth--;
    if (m_canvas) {
        flush();
        m_canvas->restore();
    }
}
