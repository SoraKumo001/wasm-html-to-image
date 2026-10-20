// P2a責務: clip + clip-path + mask (詳細は下記 責務 ブロック)。
#include <algorithm>
#include <cmath>

#include "bridge/magic_tags.h"
#include "container_skia.h"

namespace litehtml {
vector<css_token_vector> parse_comma_separated_list(const css_token_vector& tokens);
}
#include <cmath>

#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkRRect.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"
#include "libs/litehtml/include/litehtml/css_length.h"
#include "utils/skia_utils.h"

// ────────────────────────────────────────────────────────────────────────────
// 責務: clip + clip-path + mask (P2a)
// container_skia.cpp から push_mask / pop_mask を移動 (mask は clip 系)。
// paint 系 draw_* (draw_linear/radial/conic_gradient) の呼出しは残るが所有は
// container_skia.cpp 側 (paint責務)。振る舞い不変・新規throwなし。
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────
namespace {

static size_t skip_ws(const litehtml::css_token_vector& tokens, size_t i) {
    while (i < tokens.size() && tokens[i].type == ' ') ++i;
    return i;
}

static size_t find_ident_in_group(const litehtml::css_token_vector& tokens, size_t i,
                                  const std::string& name) {
    while (i < tokens.size()) {
        i = skip_ws(tokens, i);
        if (i >= tokens.size()) break;
        if (tokens[i].ident() == name) return i;
        i++;
    }
    return tokens.size();
}

}  // anonymous namespace

// ────────────────────────────────────────────────────────────────────────────
// Clip (set_clip / del_clip)
// ────────────────────────────────────────────────────────────────────────────

void container_skia::set_clip(const litehtml::position& pos,
                              const litehtml::border_radiuses& bdr_radius) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        clip_info info;
        info.pos = pos;
        info.radius = bdr_radius;
        m_clip.usedClips.push_back(info);

        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTag::ClipPush, (int)m_clip.usedClips.size()));
        m_canvas->drawRect(SkRect::MakeXYWH(0, 0, 0.001f, 0.001f), p);
    } else {
        m_canvas->save();
        if (pos.width > 0 && pos.height > 0) {
            m_canvas->clipRRect(make_rrect(pos, bdr_radius), true);
        }
    }
    m_clip.clips.push_back({pos, bdr_radius});
}

void container_skia::del_clip() {
    if (m_clip.clips.empty()) return;
    if (m_canvas) {
        flush();
        if (m_tagging) {
            SkPaint p;
            p.setColor(make_magic_color(satoru::MagicTag::ClipPop));
            m_canvas->drawRect(SkRect::MakeXYWH(0, 0, 0.001f, 0.001f), p);
        } else {
            m_canvas->restore();
        }
    }
    m_clip.clips.pop_back();
}

// ────────────────────────────────────────────────────────────────────────────
// CSS clip-path
// ────────────────────────────────────────────────────────────────────────────

SkPath container_skia::parse_clip_path(const litehtml::css_token_vector& tokens,
                                       const litehtml::position& pos) {
    SkPathBuilder builder;
    if (tokens.empty()) return builder.detach();

    // A leading `evenodd` keyword (from clip-rule) selects the even-odd fill rule.
    bool even_odd = false;
    for (const auto& tok : tokens) {
        if (tok.type == litehtml::IDENT && litehtml::lowcase(tok.ident()) == "evenodd") {
            even_odd = true;
        }
        if (tok.type == litehtml::CV_FUNCTION) {
            std::string name = litehtml::lowcase(tok.name);
            auto args = litehtml::parse_comma_separated_list(tok.value);

            if (name == "circle") {
                float cx = (float)pos.x + (float)pos.width * 0.5f;
                float cy = (float)pos.y + (float)pos.height * 0.5f;
                float r = std::min((float)pos.width, (float)pos.height) * 0.5f;

                if (!args.empty() && !args[0].empty()) {
                    size_t idx = skip_ws(args[0], 0);
                    if (idx < args[0].size()) {
                        litehtml::css_length len;
                        if (len.from_token(args[0][idx], litehtml::f_length_percentage)) {
                            r = len.calc_percent((float)std::sqrt((double)pos.width * pos.width +
                                                                  (double)pos.height * pos.height) /
                                                 (float)std::sqrt(2.0));
                        }
                        idx++;
                    }

                    size_t at_pos = find_ident_in_group(args[0], idx, "at");
                    if (at_pos < args[0].size()) {
                        size_t k = at_pos + 1;
                        k = skip_ws(args[0], k);
                        if (k < args[0].size()) {
                            litehtml::css_length lx;
                            if (lx.from_token(args[0][k], litehtml::f_length_percentage)) {
                                cx = lx.calc_percent((float)pos.width) + (float)pos.x;
                            }
                            k++;
                            k = skip_ws(args[0], k);
                            if (k < args[0].size()) {
                                litehtml::css_length ly;
                                if (ly.from_token(args[0][k], litehtml::f_length_percentage)) {
                                    cy = ly.calc_percent((float)pos.height) + (float)pos.y;
                                }
                            }
                        }
                    }
                }
                builder.addCircle(cx, cy, r);
            } else if (name == "ellipse") {
                float cx = (float)pos.x + (float)pos.width * 0.5f;
                float cy = (float)pos.y + (float)pos.height * 0.5f;
                float rx = (float)pos.width * 0.5f;
                float ry = (float)pos.height * 0.5f;

                if (!args.empty() && !args[0].empty()) {
                    size_t idx = skip_ws(args[0], 0);
                    if (idx < args[0].size()) {
                        litehtml::css_length lx;
                        if (lx.from_token(args[0][idx], litehtml::f_length_percentage)) {
                            rx = lx.calc_percent((float)pos.width);
                        }
                        idx++;
                        idx = skip_ws(args[0], idx);
                        if (idx < args[0].size()) {
                            litehtml::css_length ly;
                            if (ly.from_token(args[0][idx], litehtml::f_length_percentage)) {
                                ry = ly.calc_percent((float)pos.height);
                            }
                            idx++;
                        }
                    }

                    size_t at_pos = find_ident_in_group(args[0], idx, "at");
                    if (at_pos < args[0].size()) {
                        size_t k = at_pos + 1;
                        k = skip_ws(args[0], k);
                        if (k < args[0].size()) {
                            litehtml::css_length lx;
                            if (lx.from_token(args[0][k], litehtml::f_length_percentage)) {
                                cx = lx.calc_percent((float)pos.width) + (float)pos.x;
                            }
                            k++;
                            k = skip_ws(args[0], k);
                            if (k < args[0].size()) {
                                litehtml::css_length ly;
                                if (ly.from_token(args[0][k], litehtml::f_length_percentage)) {
                                    cy = ly.calc_percent((float)pos.height) + (float)pos.y;
                                }
                            }
                        }
                    }
                }
                builder.addOval(SkRect::MakeLTRB(cx - rx, cy - ry, cx + rx, cy + ry));
            } else if (name == "inset") {
                float top = 0, right = 0, bottom = 0, left = 0;
                litehtml::border_radiuses b_radius;

                if (!args.empty()) {
                    std::vector<litehtml::css_length> lengths;
                    bool has_round = false;
                    std::vector<litehtml::css_length> round_lengths;

                    for (const auto& group : args) {
                        if (group.empty()) continue;

                        size_t round_pos = find_ident_in_group(group, 0, "round");
                        if (round_pos < group.size()) {
                            has_round = true;
                            for (size_t j = 0; j < round_pos;) {
                                j = skip_ws(group, j);
                                if (j >= round_pos) break;
                                litehtml::css_length l;
                                if (l.from_token(group[j], litehtml::f_length_percentage)) {
                                    lengths.push_back(l);
                                }
                                j++;
                            }
                            for (size_t j = round_pos + 1; j < group.size();) {
                                j = skip_ws(group, j);
                                if (j >= group.size()) break;
                                litehtml::css_length l;
                                if (l.from_token(group[j], litehtml::f_length_percentage)) {
                                    round_lengths.push_back(l);
                                }
                                j++;
                            }
                        } else {
                            for (size_t j = 0; j < group.size();) {
                                j = skip_ws(group, j);
                                if (j >= group.size()) break;
                                litehtml::css_length l;
                                if (l.from_token(group[j], litehtml::f_length_percentage)) {
                                    lengths.push_back(l);
                                }
                                j++;
                            }
                        }
                    }

                    if (lengths.size() == 1) {
                        top = right = bottom = left = lengths[0].calc_percent((float)pos.height);
                    } else if (lengths.size() == 2) {
                        top = bottom = lengths[0].calc_percent((float)pos.height);
                        right = left = lengths[1].calc_percent((float)pos.width);
                    } else if (lengths.size() == 3) {
                        top = lengths[0].calc_percent((float)pos.height);
                        right = left = lengths[1].calc_percent((float)pos.width);
                        bottom = lengths[2].calc_percent((float)pos.height);
                    } else if (lengths.size() >= 4) {
                        top = lengths[0].calc_percent((float)pos.height);
                        right = lengths[1].calc_percent((float)pos.width);
                        bottom = lengths[2].calc_percent((float)pos.height);
                        left = lengths[3].calc_percent((float)pos.width);
                    }

                    if (has_round && !round_lengths.empty()) {
                        float rr =
                            round_lengths[0].calc_percent((float)std::min(pos.width, pos.height));
                        b_radius.top_left_x = b_radius.top_left_y = (int)rr;
                        b_radius.top_right_x = b_radius.top_right_y = (int)rr;
                        b_radius.bottom_right_x = b_radius.bottom_right_y = (int)rr;
                        b_radius.bottom_left_x = b_radius.bottom_left_y = (int)rr;
                    }
                }
                SkRect r = SkRect::MakeLTRB((float)pos.x + left, (float)pos.y + top,
                                            (float)pos.x + (float)pos.width - right,
                                            (float)pos.y + (float)pos.height - bottom);
                if (b_radius.is_zero()) {
                    builder.addRect(r);
                } else {
                    builder.addRRect(make_rrect(litehtml::position((int)r.fLeft, (int)r.fTop,
                                                                   (int)r.width(), (int)r.height()),
                                                b_radius));
                }
            } else if (name == "polygon") {
                bool first = true;
                for (const auto& group : args) {
                    size_t idx = skip_ws(group, 0);
                    if (idx >= group.size()) continue;
                    // polygon(<fill-rule>, ...): the keyword group is not a point.
                    if (group[idx].type == litehtml::IDENT) {
                        std::string kw = litehtml::lowcase(group[idx].ident());
                        if (kw == "evenodd") even_odd = true;
                        else if (kw == "nonzero") even_odd = false;
                        continue;
                    }
                    litehtml::css_length lx;
                    if (!lx.from_token(group[idx], litehtml::f_length_percentage)) continue;
                    idx++;
                    idx = skip_ws(group, idx);
                    if (idx >= group.size()) continue;
                    litehtml::css_length ly;
                    if (!ly.from_token(group[idx], litehtml::f_length_percentage)) continue;

                    float px = lx.calc_percent((float)pos.width) + (float)pos.x;
                    float py = ly.calc_percent((float)pos.height) + (float)pos.y;
                    if (first) {
                        builder.moveTo(px, py);
                        first = false;
                    } else {
                        builder.lineTo(px, py);
                    }
                }
                builder.close();
            }
        }
    }
    if (even_odd) builder.setFillType(SkPathFillType::kEvenOdd);
    return builder.detach();
}

void container_skia::push_clip_path(litehtml::uint_ptr hdc,
                                    const litehtml::css_token_vector& clip_path,
                                    const litehtml::position& pos) {
    if (!m_canvas || clip_path.empty()) return;
    flush();

    if (m_tagging) {
        clip_path_info info;
        info.tokens = clip_path;
        info.pos = pos;
        m_clip.usedClipPaths.push_back(info);
        int index = (int)m_clip.usedClipPaths.size();

        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTag::ClipPathPush, index));

        SkRect rect;
        if (!m_clip.clips.empty()) {
            rect = SkRect::MakeXYWH((float)m_clip.clips.back().first.x, (float)m_clip.clips.back().first.y,
                                    (float)m_clip.clips.back().first.width,
                                    (float)m_clip.clips.back().first.height);
        } else {
            rect = SkRect::MakeWH((float)m_width, (float)m_height);
        }

        m_canvas->drawRect(rect, p);
        m_clip.clipPathDepth++;
        return;
    }

    SkPath path = container_skia::parse_clip_path(clip_path, pos);
    if (!path.isEmpty()) {
        m_canvas->save();
        m_canvas->clipPath(path, true);
        m_clip.clipPathDepth++;
    } else {
        m_canvas->save();
        m_clip.clipPathDepth++;
    }
}

void container_skia::pop_clip_path(litehtml::uint_ptr hdc) {
    if (m_clip.clipPathDepth <= 0) return;
    m_clip.clipPathDepth--;

    if (m_canvas) {
        flush();
        if (m_tagging) {
            SkPaint p;
            p.setColor(make_magic_color(satoru::MagicTag::ClipPathPop));
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
// CSS mask (P2a: container_skia.cpp から移動。状態は m_clip へ分離済み)
// ────────────────────────────────────────────────────────────────────────────

void container_skia::push_mask(litehtml::uint_ptr hdc, const litehtml::css_token_vector& mask,
                               const litehtml::position& pos) {
    if (!m_canvas || mask.empty()) return;
    flush();

    // mask url() images are not seen by litehtml's background loader: request them here.
    if (m_resourceManager) {
        for (const auto& layer_tokens : litehtml::parse_comma_separated_list(mask)) {
            for (const auto& tok : layer_tokens) {
                if (tok.type == litehtml::CV_FUNCTION && litehtml::lowcase(tok.name) == "url" &&
                    !tok.value.empty() && !tok.value.front().str.empty()) {
                    const std::string& url = tok.value.front().str;
                    m_resourceManager->request(url, url, ResourceType::Image, false);
                }
            }
        }
    }

    if (m_tagging) {
        mask_info info;
        info.tokens = mask;
        info.pos = pos;
        m_clip.usedMasks.push_back(info);
        int index = (int)m_clip.usedMasks.size();

        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTag::MaskPush, index));

        SkRect rect;
        if (!m_clip.clips.empty()) {
            rect = SkRect::MakeXYWH((float)m_clip.clips.back().first.x,
                                    (float)m_clip.clips.back().first.y,
                                    (float)m_clip.clips.back().first.width,
                                    (float)m_clip.clips.back().first.height);
        } else {
            rect = SkRect::MakeWH((float)m_width, (float)m_height);
        }

        m_canvas->drawRect(rect, p);
        m_clip.maskDepth++;
        return;
    }

    m_clip.maskStack.push_back({mask, pos});
    m_canvas->saveLayer(
        SkRect::MakeXYWH((float)pos.x, (float)pos.y, (float)pos.width, (float)pos.height), nullptr);
    m_clip.maskDepth++;
}

void container_skia::pop_mask(litehtml::uint_ptr hdc) {
    if (m_clip.maskDepth <= 0) return;
    m_clip.maskDepth--;

    if (m_canvas) {
        flush();
        if (m_tagging) {
            SkPaint p;
            p.setColor(make_magic_color(satoru::MagicTag::MaskPop));
            SkRect rect;
            if (!m_clip.clips.empty()) {
                rect = SkRect::MakeXYWH(
                    (float)m_clip.clips.back().first.x, (float)m_clip.clips.back().first.y,
                    (float)m_clip.clips.back().first.width,
                    (float)m_clip.clips.back().first.height);
            } else {
                rect = SkRect::MakeWH((float)m_width, (float)m_height);
            }
            m_canvas->drawRect(rect, p);
            return;
        }

        auto mask_data = m_clip.maskStack.back();
        m_clip.maskStack.pop_back();

        const auto& mask_tokens = mask_data.first;
        const auto& pos = mask_data.second;

        // Start mask composite layer
        SkPaint mask_composite_paint;
        mask_composite_paint.setBlendMode(SkBlendMode::kDstIn);
        m_canvas->saveLayer(nullptr, &mask_composite_paint);

        auto layers = litehtml::parse_comma_separated_list(mask_tokens);

        for (const auto& layer_tokens : layers) {
            // Split a layer into <image> and the shorthand parts: <position> [/ <size>] <repeat>.
            const litehtml::css_token* image_tok = nullptr;
            std::vector<litehtml::css_length> pos_vals, size_vals;
            std::vector<std::string> pos_keys;
            bool size_contain = false, size_cover = false, after_slash = false;
            bool rep_x = true, rep_y = true;
            for (const auto& tok : layer_tokens) {
                if (tok.type == litehtml::CV_FUNCTION) {
                    std::string name = litehtml::lowcase(tok.name);
                    if (!image_tok && (name == "url" || name.find("gradient") != std::string::npos))
                        image_tok = &tok;
                } else if (tok.type == '/') {
                    after_slash = true;
                } else if (tok.type == litehtml::IDENT) {
                    std::string id = litehtml::lowcase(tok.ident());
                    if (id == "no-repeat") {
                        rep_x = rep_y = false;
                    } else if (id == "repeat-x") {
                        rep_x = true;
                        rep_y = false;
                    } else if (id == "repeat-y") {
                        rep_x = false;
                        rep_y = true;
                    } else if (id == "repeat" || id == "space" || id == "round") {
                        rep_x = rep_y = true;
                    } else if (id == "contain") {
                        size_contain = true;
                    } else if (id == "cover") {
                        size_cover = true;
                    } else if (id == "auto") {
                        if (after_slash) size_vals.push_back(litehtml::css_length());
                    } else if (!after_slash && (id == "left" || id == "right" || id == "top" ||
                                                id == "bottom" || id == "center")) {
                        pos_keys.push_back(id);
                    }
                } else if (tok.type == litehtml::DIMENSION || tok.type == litehtml::PERCENTAGE ||
                           tok.type == litehtml::NUMBER) {
                    litehtml::css_length len;
                    if (len.from_token(tok, litehtml::f_length_percentage | litehtml::f_positive)) {
                        (after_slash ? size_vals : pos_vals).push_back(len);
                    }
                }
            }
            if (!image_tok) continue;
            // A default-constructed (predefined) length means "auto".
            auto is_auto = [](const litehtml::css_length& l) { return l.is_predefined(); };

            const float bw = (float)pos.width, bh = (float)pos.height;
            const std::string iname = litehtml::lowcase(image_tok->name);
            sk_sp<SkImage> img;
            float iw = bw, ih = bh;
            if (iname == "url") {
                if (image_tok->value.empty()) continue;
                auto it = m_context.imageCache.find(image_tok->value.front().str);
                if (it == m_context.imageCache.end() || !it->second.skImage) continue;
                img = it->second.skImage;
                iw = (float)img->width();
                ih = (float)img->height();
            }
            // Tile size (background-size semantics).
            float tw = iw, th = ih;
            if (size_contain || size_cover) {
                float k = size_contain ? std::min(bw / iw, bh / ih) : std::max(bw / iw, bh / ih);
                tw = iw * k;
                th = ih * k;
            } else if (!size_vals.empty()) {
                bool aw = is_auto(size_vals[0]);
                bool ah = size_vals.size() < 2 || is_auto(size_vals[1]);
                float w = aw ? 0.f : (float)size_vals[0].calc_percent(bw);
                float h = ah ? 0.f : (float)size_vals[1].calc_percent(bh);
                if (aw && ah) {
                    w = iw;
                    h = ih;
                } else if (aw) {
                    w = ih > 0 ? h * iw / ih : h;
                } else if (ah) {
                    h = iw > 0 ? w * ih / iw : w;
                }
                tw = w;
                th = h;
            }
            if (tw <= 0 || th <= 0) continue;
            // Tile origin from <position> (default 0% 0%).
            auto axis = [&](bool horizontal) {
                float room = horizontal ? bw - tw : bh - th;
                const std::string lo = horizontal ? "left" : "top";
                const std::string hi = horizontal ? "right" : "bottom";
                const std::string other_lo = horizontal ? "top" : "left";
                const std::string other_hi = horizontal ? "bottom" : "right";
                bool named_this = false, named_other = false;
                float frac = 0.f;
                for (const auto& k : pos_keys) {
                    if (k == lo) {
                        frac = 0.f;
                        named_this = true;
                    } else if (k == hi) {
                        frac = 1.f;
                        named_this = true;
                    } else if (k == other_lo || k == other_hi) {
                        named_other = true;
                    }
                }
                if (named_this) return room * frac;
                size_t centers = (size_t)std::count(pos_keys.begin(), pos_keys.end(), "center");
                if (centers > 0 && (centers >= 2 || named_other || pos_keys.size() == 1)) {
                    return room * 0.5f;
                }
                if (!pos_vals.empty()) {
                    // First numeric value is x, the second is y (a single value centers y).
                    size_t idx = horizontal ? 0 : 1;
                    if (idx < pos_vals.size()) return (float)pos_vals[idx].calc_percent(room);
                    return room * 0.5f;
                }
                return 0.f;
            };
            float ox = (float)pos.x + axis(true);
            float oy = (float)pos.y + axis(false);

            SkRect box = SkRect::MakeXYWH((float)pos.x, (float)pos.y, bw, bh);
            m_canvas->save();
            m_canvas->clipRect(box);
            // Tile index range covering the box when repeating.
            int kx0 = 0, kx1 = 0, ky0 = 0, ky1 = 0;
            if (rep_x) {
                kx0 = (int)std::floor(((float)pos.x - ox) / tw);
                kx1 = (int)std::ceil(((float)pos.x + bw - ox) / tw) - 1;
            }
            if (rep_y) {
                ky0 = (int)std::floor(((float)pos.y - oy) / th);
                ky1 = (int)std::ceil(((float)pos.y + bh - oy) / th) - 1;
            }
            if ((kx1 - kx0 + 1) * (ky1 - ky0 + 1) > 4096) {  // tiny tiles: avoid a runaway loop
                kx1 = kx0;
                ky1 = ky0;
            }
            for (int ky = ky0; ky <= ky1; ky++) {
                for (int kx = kx0; kx <= kx1; kx++) {
                    SkRect tile = SkRect::MakeXYWH(ox + kx * tw, oy + ky * th, tw, th);
                    if (img) {
                        SkPaint p;
                        p.setAntiAlias(true);
                        m_canvas->drawImageRect(img, tile, SkSamplingOptions(SkFilterMode::kLinear),
                                                &p);
                    } else {
                        litehtml::gradient g;
                        if (!litehtml::parse_gradient(*image_tok, g, nullptr)) continue;
                        litehtml::position tpos((litehtml::pixel_t)tile.x(),
                                                (litehtml::pixel_t)tile.y(),
                                                (litehtml::pixel_t)tile.width(),
                                                (litehtml::pixel_t)tile.height());
                        litehtml::background_layer layer;
                        layer.origin_box = tpos;
                        layer.border_box = tpos;
                        layer.clip_box = tpos;
                        m_canvas->save();
                        m_canvas->clipRect(tile);
                        if (iname.find("linear") != std::string::npos) {
                            auto grad = litehtml::background::get_linear_gradient(g, tpos);
                            if (grad) draw_linear_gradient(0, layer, *grad);
                        } else if (iname.find("radial") != std::string::npos) {
                            auto grad = litehtml::background::get_radial_gradient(g, tpos);
                            if (grad) draw_radial_gradient(0, layer, *grad);
                        } else {
                            auto grad = litehtml::background::get_conic_gradient(g, tpos);
                            if (grad) draw_conic_gradient(0, layer, *grad);
                        }
                        m_canvas->restore();
                    }
                }
            }
            m_canvas->restore();
        }

        m_canvas->restore();  // composite mask into content
        m_canvas->restore();  // composite content into main canvas
    }
}

// on_unknown_property は本ファイル所属 (下記)。旧末尾コメントの
// 「→ container_skia.cpp」は陳腐化のため削除 (P2a)。

void container_skia::on_unknown_property(const litehtml::string& name,
                                         const litehtml::css_token_vector& value) {
    if (name == "transition" || name == "animation" || name == "resize" ||
        name == "scrollbar-width" || name == "-webkit-box-flex" || name == "-ms-overflow-style" ||
        name == "-webkit-overflow-scrolling" || name == "-webkit-font-smoothing" ||
        name == "color-scheme" || name == "-webkit-text-size-adjust" || name == "line-break" ||
        name == "text-size-adjust") {
        return;
    }
}
