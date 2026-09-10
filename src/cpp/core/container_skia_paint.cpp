// P4責務: paint (draw_*系 9関数) (詳細は下記 責務ブロック)。
#include "container_skia.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string_view>

#include "bridge/magic_tags.h"
#include "container_skia_helpers.h"
#include "core/text/text_layout.h"
#include "core/text/text_renderer.h"
#include "el_svg.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkBlurTypes.h"
#include "include/core/SkClipOp.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkMaskFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkRRect.h"
#include "include/core/SkShader.h"
#include "include/core/SkString.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTileMode.h"
#include "include/effects/SkColorMatrix.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/effects/SkGradient.h"
#include "include/effects/SkImageFilters.h"
#include "include/effects/SkRuntimeEffect.h"
#include "litehtml/css_parser.h"
#include "litehtml/el_table.h"
#include "litehtml/el_td.h"
#include "litehtml/el_tr.h"
#include "litehtml/render_item.h"
#include "text_utils.h"
#include "utils/skia_utils.h"
#include "utils/skunicode_satoru.h"
// ────────────────────────────────────────────────────────────────────────────
// 責務 (P4): paint — document_container の draw_* 群
//  - container_skia.cpp §3 (およびmisc領域の draw_list_marker) から物理分離。
//    P4は関数移動のみ (本体逐語・シグネチャ不変)。
//  - draw_box_shadow/draw_image/draw_solid_fill/draw_linear_gradient/
//    draw_radial_gradient/draw_conic_gradient/draw_border_image/draw_borders/
//    draw_list_marker (9関数)
//  - ファイルローカル helper (darken/lighten/get_background_rrect) も同伴移動。
//    trim は text(create_font)が使うため container_skia.cpp に残留。
//  - 宣言 (PaintState/virtual draw_*) は container_skia.h に維持。
//  - 公開シグネチャ・litehtml I/F・返却値・throw挙動は不変。新規throwなし。
// ────────────────────────────────────────────────────────────────────────────

namespace {
static SkColor darken(litehtml::web_color c, float fraction) {
    return SkColorSetARGB(c.alpha,
                          (uint8_t)std::max(0.0f, (float)c.red - ((float)c.red * fraction)),
                          (uint8_t)std::max(0.0f, (float)c.green - ((float)c.green * fraction)),
                          (uint8_t)std::max(0.0f, (float)c.blue - ((float)c.blue * fraction)));
}

static SkColor lighten(litehtml::web_color c, float fraction) {
    return SkColorSetARGB(
        c.alpha, (uint8_t)std::min(255.0f, (float)c.red + ((255.0f - (float)c.red) * fraction)),
        (uint8_t)std::min(255.0f, (float)c.green + ((255.0f - (float)c.green) * fraction)),
        (uint8_t)std::min(255.0f, (float)c.blue + ((255.0f - (float)c.blue) * fraction)));
}

SkRRect get_background_rrect(const litehtml::background_layer& layer) {
    litehtml::position intersect_box = layer.border_box.intersect(layer.clip_box);
    if (intersect_box.width <= 0 || intersect_box.height <= 0) {
        return SkRRect::MakeEmpty();
    }

    litehtml::border_radiuses rad = layer.border_radius;
    float offset_l = std::max(0.0f, intersect_box.x - layer.border_box.x);
    float offset_t = std::max(0.0f, intersect_box.y - layer.border_box.y);
    float offset_r = std::max(0.0f, layer.border_box.right() - intersect_box.right());
    float offset_b = std::max(0.0f, layer.border_box.bottom() - intersect_box.bottom());

    rad.top_left_x = std::max(0.0f, rad.top_left_x - offset_l);
    rad.top_left_y = std::max(0.0f, rad.top_left_y - offset_t);
    rad.top_right_x = std::max(0.0f, rad.top_right_x - offset_r);
    rad.top_right_y = std::max(0.0f, rad.top_right_y - offset_t);
    rad.bottom_right_x = std::max(0.0f, rad.bottom_right_x - offset_r);
    rad.bottom_right_y = std::max(0.0f, rad.bottom_right_y - offset_b);
    rad.bottom_left_x = std::max(0.0f, rad.bottom_left_x - offset_l);
    rad.bottom_left_y = std::max(0.0f, rad.bottom_left_y - offset_b);

    return make_rrect(intersect_box, rad);
}
}  // namespace

// ── draw_* 8関数 (container_skia.cpp §3 から移動, P4) ──
void container_skia::draw_box_shadow(litehtml::uint_ptr hdc, const litehtml::shadow_vector& shadows,
                                     const litehtml::position& pos,
                                     const litehtml::border_radiuses& radius, bool inset) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        for (auto it = shadows.rbegin(); it != shadows.rend(); ++it) {
            const auto& s = *it;
            if (s.inset != inset) continue;
            shadow_info info;
            info.color = s.color;
            info.blur = (float)s.blur.val();
            info.x = (float)s.x.val();
            info.y = (float)s.y.val();
            info.spread = (float)s.spread.val();
            info.inset = inset;
            info.box_pos = pos;
            info.box_radius = radius;
            info.opacity = get_current_opacity();
            m_paint.shadows.push_back(info);
            int index = (int)m_paint.shadows.size();
            SkPaint p;
            p.setColor(make_magic_color(satoru::MagicTag::Shadow, index));
            m_canvas->drawRRect(make_rrect(pos, radius), p);
        }
        return;
    }
    for (auto it = shadows.rbegin(); it != shadows.rend(); ++it) {
        const auto& s = *it;
        if (s.inset != inset) continue;
        SkRRect box_rrect = make_rrect(pos, radius);
        SkColor shadow_color =
            SkColorSetARGB(s.color.alpha, s.color.red, s.color.green, s.color.blue);
        float blur_std_dev = (float)s.blur.val() * 0.5f;
        m_canvas->save();
        if (inset) {
            m_canvas->clipRRect(box_rrect, true);
            SkRRect shadow_rrect = box_rrect;
            shadow_rrect.inset(-(float)s.spread.val(), -(float)s.spread.val());
            SkPaint p;
            p.setAntiAlias(true);
            p.setColor(shadow_color);
            if (blur_std_dev > 0)
                p.setMaskFilter(SkMaskFilter::MakeBlur(kNormal_SkBlurStyle, blur_std_dev));
            SkRect hr = box_rrect.rect();
            hr.outset(blur_std_dev * 3 + std::abs((float)s.x.val()) + 100,
                      blur_std_dev * 3 + std::abs((float)s.y.val()) + 100);
            m_canvas->translate((float)s.x.val(), (float)s.y.val());
            m_canvas->drawPath(
                SkPathBuilder().addRect(hr).addRRect(shadow_rrect, SkPathDirection::kCCW).detach(),
                p);
        } else {
            m_canvas->clipRRect(box_rrect, SkClipOp::kDifference, true);
            SkRRect shadow_rrect = box_rrect;
            shadow_rrect.outset((float)s.spread.val(), (float)s.spread.val());
            SkPaint p;
            p.setAntiAlias(true);
            p.setColor(shadow_color);
            if (blur_std_dev > 0)
                p.setMaskFilter(SkMaskFilter::MakeBlur(kNormal_SkBlurStyle, blur_std_dev));
            m_canvas->translate((float)s.x.val(), (float)s.y.val());
            m_canvas->drawRRect(shadow_rrect, p);
        }
        m_canvas->restore();
    }
}

void container_skia::draw_image(litehtml::uint_ptr hdc, const litehtml::background_layer& layer,
                                const std::string& url, const std::string& base_url,
                                litehtml::object_fit fit,
                                const litehtml::css_token_vector& object_position) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        image_draw_info draw;
        draw.url = url;
        draw.layer = layer;
        draw.opacity = 1.0f;
        draw.object_fit = fit;
        draw.object_position = object_position;

        // Use background layer's clip_box as primary clipping
        draw.has_clip = true;
        litehtml::position intersect_box = layer.border_box.intersect(layer.clip_box);
        draw.clip_pos = intersect_box;

        float offset_l = std::max(0.0f, intersect_box.x - layer.border_box.x);
        float offset_t = std::max(0.0f, intersect_box.y - layer.border_box.y);
        float offset_r = std::max(0.0f, layer.border_box.right() - intersect_box.right());
        float offset_b = std::max(0.0f, layer.border_box.bottom() - intersect_box.bottom());

        draw.clip_radius = layer.border_radius;
        draw.clip_radius.top_left_x = std::max(0.0f, draw.clip_radius.top_left_x - offset_l);
        draw.clip_radius.top_left_y = std::max(0.0f, draw.clip_radius.top_left_y - offset_t);
        draw.clip_radius.top_right_x = std::max(0.0f, draw.clip_radius.top_right_x - offset_r);
        draw.clip_radius.top_right_y = std::max(0.0f, draw.clip_radius.top_right_y - offset_t);
        draw.clip_radius.bottom_right_x =
            std::max(0.0f, draw.clip_radius.bottom_right_x - offset_r);
        draw.clip_radius.bottom_right_y =
            std::max(0.0f, draw.clip_radius.bottom_right_y - offset_b);
        draw.clip_radius.bottom_left_x = std::max(0.0f, draw.clip_radius.bottom_left_x - offset_l);
        draw.clip_radius.bottom_left_y = std::max(0.0f, draw.clip_radius.bottom_left_y - offset_b);

        int index = (int)m_paint.imageDraws.size() + 1;
        draw.tag_index = index;
        m_paint.imageDraws.push_back(draw);

        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTagExtended::ImageDraw, index));

        // Fill the clip_box area with magic color
        m_canvas->drawRect(
            SkRect::MakeXYWH((float)layer.clip_box.x, (float)layer.clip_box.y,
                             (float)layer.clip_box.width, (float)layer.clip_box.height),
            p);
    } else {
        auto it = m_context.imageCache.find(url);
        if (it != m_context.imageCache.end() && it->second.skImage) {
            SkPaint p;
            p.setAntiAlias(true);

            m_canvas->save();
            // Clip to layer.clip_box which respects background-clip
            m_canvas->clipRRect(get_background_rrect(layer), true);

            SkRect dst =
                SkRect::MakeXYWH((float)layer.origin_box.x, (float)layer.origin_box.y,
                                 (float)layer.origin_box.width, (float)layer.origin_box.height);

            if (layer.repeat == litehtml::background_repeat_no_repeat) {
                m_canvas->drawImageRect(it->second.skImage, dst,
                                        SkSamplingOptions(SkFilterMode::kLinear), &p);
            } else {
                SkTileMode tileX = SkTileMode::kRepeat;
                SkTileMode tileY = SkTileMode::kRepeat;

                switch (layer.repeat) {
                    case litehtml::background_repeat_repeat:
                        tileX = SkTileMode::kRepeat;
                        tileY = SkTileMode::kRepeat;
                        break;
                    case litehtml::background_repeat_repeat_x:
                        tileX = SkTileMode::kRepeat;
                        tileY = SkTileMode::kDecal;
                        break;
                    case litehtml::background_repeat_repeat_y:
                        tileX = SkTileMode::kDecal;
                        tileY = SkTileMode::kRepeat;
                        break;
                    case litehtml::background_repeat_no_repeat:
                        tileX = SkTileMode::kDecal;
                        tileY = SkTileMode::kDecal;
                        break;
                }

                float scaleX = (float)layer.origin_box.width / it->second.skImage->width();
                float scaleY = (float)layer.origin_box.height / it->second.skImage->height();

                SkMatrix matrix;
                matrix.setScaleTranslate(scaleX, scaleY, (float)layer.origin_box.x,
                                         (float)layer.origin_box.y);

                p.setShader(it->second.skImage->makeShader(
                    tileX, tileY, SkSamplingOptions(SkFilterMode::kLinear), &matrix));

                m_canvas->drawRect(
                    SkRect::MakeXYWH((float)layer.clip_box.x, (float)layer.clip_box.y,
                                     (float)layer.clip_box.width, (float)layer.clip_box.height),
                    p);
            }
            m_canvas->restore();
        }
    }
}

void container_skia::draw_solid_fill(litehtml::uint_ptr hdc,
                                     const litehtml::background_layer& layer,
                                     const litehtml::web_color& color) {
    if (!m_canvas) return;
    flush();
    SkPaint p;
    p.setColor(SkColorSetARGB(color.alpha, color.red, color.green, color.blue));
    p.setAntiAlias(true);
    m_canvas->drawRRect(get_background_rrect(layer), p);
}

void container_skia::draw_linear_gradient(
    litehtml::uint_ptr hdc, const litehtml::background_layer& layer,
    const litehtml::background_layer::linear_gradient& gradient) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        linear_gradient_info info;
        info.layer = layer;
        info.gradient = gradient;
        info.opacity = 1.0f;
        m_paint.linearGradients.push_back(info);
        int index = (int)m_paint.linearGradients.size();
        SkPaint p;
        if (layer.is_text_clip) {
            p.setColor(make_magic_color(satoru::MagicTagExtended::TextClipLinearGradient, index));
        } else {
            p.setColor(make_magic_color(satoru::MagicTagExtended::LinearGradient, index));
        }
        m_canvas->drawRRect(get_background_rrect(layer), p);
    } else {
        if (layer.origin_box.width <= 0 || layer.origin_box.height <= 0) return;

        // Store text-clip gradients for compositing in draw_text
        if (layer.is_text_clip) {
            pending_text_clip tc;
            tc.layer = layer;
            tc.gradient = gradient;
            m_paint.pendingTextClips.push_back(tc);
            return;
        }

        SkBitmap tileBitmap;
        tileBitmap.allocN32Pixels((int)layer.origin_box.width, (int)layer.origin_box.height);
        SkCanvas tileCanvas(tileBitmap);
        tileCanvas.clear(SK_ColorTRANSPARENT);

        SkPoint pts[2] = {SkPoint::Make((float)gradient.start.x - (float)layer.origin_box.x,
                                        (float)gradient.start.y - (float)layer.origin_box.y),
                          SkPoint::Make((float)gradient.end.x - (float)layer.origin_box.x,
                                        (float)gradient.end.y - (float)layer.origin_box.y)};
        std::vector<SkColor4f> colors;
        std::vector<float> pos;
        for (const auto& stop : gradient.color_points) {
            colors.push_back({stop.color.red / 255.0f, stop.color.green / 255.0f,
                              stop.color.blue / 255.0f, stop.color.alpha / 255.0f});
            pos.push_back(stop.offset);
        }

        SkGradient sk_grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                           SkGradient::Interpolation());
        SkPaint p;
        p.setShader(SkShaders::LinearGradient(pts, sk_grad));
        p.setAntiAlias(true);
        tileCanvas.drawRect(
            SkRect::MakeWH((float)layer.origin_box.width, (float)layer.origin_box.height), p);

        SkTileMode tileX = SkTileMode::kRepeat;
        SkTileMode tileY = SkTileMode::kRepeat;
        if (layer.repeat == litehtml::background_repeat_no_repeat) {
            tileX = tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_x) {
            tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_y) {
            tileX = SkTileMode::kDecal;
        }

        SkMatrix matrix;
        matrix.setTranslate((float)layer.origin_box.x, (float)layer.origin_box.y);

        SkPaint repeatPaint;
        repeatPaint.setShader(tileBitmap.makeShader(tileX, tileY, SkSamplingOptions(), &matrix));
        repeatPaint.setAntiAlias(true);

        m_canvas->save();
        m_canvas->clipRRect(get_background_rrect(layer), true);
        m_canvas->drawRect(
            SkRect::MakeXYWH((float)layer.clip_box.x, (float)layer.clip_box.y,
                             (float)layer.clip_box.width, (float)layer.clip_box.height),
            repeatPaint);
        m_canvas->restore();
    }
}

void container_skia::draw_radial_gradient(
    litehtml::uint_ptr hdc, const litehtml::background_layer& layer,
    const litehtml::background_layer::radial_gradient& gradient) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        radial_gradient_info info;
        info.layer = layer;
        info.gradient = gradient;
        info.opacity = 1.0f;
        m_paint.radialGradients.push_back(info);
        int index = (int)m_paint.radialGradients.size();
        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTagExtended::RadialGradient, index));
        m_canvas->drawRRect(get_background_rrect(layer), p);
    } else {
        if (layer.origin_box.width <= 0 || layer.origin_box.height <= 0) return;

        SkBitmap tileBitmap;
        tileBitmap.allocN32Pixels((int)layer.origin_box.width, (int)layer.origin_box.height);
        SkCanvas tileCanvas(tileBitmap);
        tileCanvas.clear(SK_ColorTRANSPARENT);

        SkPoint center = SkPoint::Make((float)gradient.position.x - (float)layer.origin_box.x,
                                       (float)gradient.position.y - (float)layer.origin_box.y);
        float rx = (float)gradient.radius.x, ry = (float)gradient.radius.y;
        if (rx <= 0 || ry <= 0) return;
        std::vector<SkColor4f> colors;
        std::vector<float> pos;
        for (const auto& stop : gradient.color_points) {
            colors.push_back({stop.color.red / 255.0f, stop.color.green / 255.0f,
                              stop.color.blue / 255.0f, stop.color.alpha / 255.0f});
            pos.push_back(stop.offset);
        }
        SkMatrix matrix;
        matrix.setScale(1.0f, ry / rx, center.x(), center.y());

        SkGradient sk_grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                           SkGradient::Interpolation());
        SkPaint p;
        p.setShader(SkShaders::RadialGradient(center, rx, sk_grad, &matrix));
        p.setAntiAlias(true);
        tileCanvas.drawRect(
            SkRect::MakeWH((float)layer.origin_box.width, (float)layer.origin_box.height), p);

        SkTileMode tileX = SkTileMode::kRepeat;
        SkTileMode tileY = SkTileMode::kRepeat;
        if (layer.repeat == litehtml::background_repeat_no_repeat) {
            tileX = tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_x) {
            tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_y) {
            tileX = SkTileMode::kDecal;
        }

        SkMatrix repeatMatrix;
        repeatMatrix.setTranslate((float)layer.origin_box.x, (float)layer.origin_box.y);

        SkPaint repeatPaint;
        repeatPaint.setShader(
            tileBitmap.makeShader(tileX, tileY, SkSamplingOptions(), &repeatMatrix));
        repeatPaint.setAntiAlias(true);

        m_canvas->save();
        m_canvas->clipRRect(get_background_rrect(layer), true);
        m_canvas->drawRect(
            SkRect::MakeXYWH((float)layer.clip_box.x, (float)layer.clip_box.y,
                             (float)layer.clip_box.width, (float)layer.clip_box.height),
            repeatPaint);
        m_canvas->restore();
    }
}

void container_skia::draw_conic_gradient(
    litehtml::uint_ptr hdc, const litehtml::background_layer& layer,
    const litehtml::background_layer::conic_gradient& gradient) {
    if (!m_canvas) return;
    flush();
    if (m_tagging) {
        conic_gradient_info info;
        info.layer = layer;
        info.gradient = gradient;
        info.opacity = 1.0f;
        m_paint.conicGradients.push_back(info);
        int index = (int)m_paint.conicGradients.size();
        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTagExtended::ConicGradient, index));
        m_canvas->drawRRect(get_background_rrect(layer), p);
    } else {
        if (layer.origin_box.width <= 0 || layer.origin_box.height <= 0) return;

        SkBitmap tileBitmap;
        tileBitmap.allocN32Pixels((int)layer.origin_box.width, (int)layer.origin_box.height);
        SkCanvas tileCanvas(tileBitmap);
        tileCanvas.clear(SK_ColorTRANSPARENT);

        SkPoint center = SkPoint::Make((float)gradient.position.x - (float)layer.origin_box.x,
                                       (float)gradient.position.y - (float)layer.origin_box.y);
        std::vector<SkColor4f> colors;
        std::vector<float> pos;
        for (size_t i = 0; i < gradient.color_points.size(); ++i) {
            const auto& stop = gradient.color_points[i];
            colors.push_back({stop.color.red / 255.0f, stop.color.green / 255.0f,
                              stop.color.blue / 255.0f, stop.color.alpha / 255.0f});
            float offset = stop.offset;
            if (i > 0 && offset <= pos.back()) {
                offset = pos.back() + 0.00001f;
            }
            pos.push_back(offset);
        }
        if (!pos.empty() && pos.back() > 1.0f) {
            float max_val = pos.back();
            for (auto& p : pos) p /= max_val;
            pos.back() = 1.0f;
        }

        SkGradient sk_grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                           SkGradient::Interpolation());
        SkMatrix matrix;
        matrix.setRotate(gradient.angle - 90.0f, center.x(), center.y());
        SkPaint p;
        p.setShader(SkShaders::SweepGradient(center, sk_grad, &matrix));
        p.setAntiAlias(true);
        tileCanvas.drawRect(
            SkRect::MakeWH((float)layer.origin_box.width, (float)layer.origin_box.height), p);

        SkTileMode tileX = SkTileMode::kRepeat;
        SkTileMode tileY = SkTileMode::kRepeat;
        if (layer.repeat == litehtml::background_repeat_no_repeat) {
            tileX = tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_x) {
            tileY = SkTileMode::kDecal;
        } else if (layer.repeat == litehtml::background_repeat_repeat_y) {
            tileX = SkTileMode::kDecal;
        }

        SkMatrix repeatMatrix;
        repeatMatrix.setTranslate((float)layer.origin_box.x, (float)layer.origin_box.y);

        SkPaint repeatPaint;
        repeatPaint.setShader(
            tileBitmap.makeShader(tileX, tileY, SkSamplingOptions(), &repeatMatrix));
        repeatPaint.setAntiAlias(true);

        m_canvas->save();
        m_canvas->clipRRect(get_background_rrect(layer), true);
        m_canvas->drawRect(
            SkRect::MakeXYWH((float)layer.clip_box.x, (float)layer.clip_box.y,
                             (float)layer.clip_box.width, (float)layer.clip_box.height),
            repeatPaint);
        m_canvas->restore();
    }
}

#include "api/satoru_api.h"
#include "bridge/bridge_types.h"

void container_skia::draw_border_image(litehtml::uint_ptr hdc,
                                       const litehtml::border_image& border_image,
                                       const litehtml::borders& borders,
                                       const litehtml::position& draw_pos, bool root) {
    if (!m_canvas) return;
    flush();

    if (m_tagging) {
        border_image_info info;
        info.border_image = border_image;
        info.borders = borders;
        info.draw_pos = draw_pos;
        info.opacity = get_current_opacity();
        m_paint.borderImages.push_back(info);
        int index = (int)m_paint.borderImages.size();

        SkPaint p;
        p.setColor(make_magic_color(satoru::MagicTagExtended::BorderImage, index));
        m_canvas->drawRect(SkRect::MakeXYWH((float)draw_pos.x, (float)draw_pos.y,
                                            (float)draw_pos.width, (float)draw_pos.height),
                           p);
        return;
    }

    sk_sp<SkImage> img;
    if (border_image.source.type == litehtml::image::type_url) {
        auto it = m_context.imageCache.find(border_image.source.url);
        if (it == m_context.imageCache.end() || !it->second.skImage) return;
        img = it->second.skImage;
    } else if (border_image.source.type == litehtml::image::type_gradient) {
        // For border-image, the gradient's intrinsic size is the border image area.
        int w = draw_pos.width;
        int h = draw_pos.height;
        if (w <= 0 || h <= 0) return;

        SkBitmap bitmap;
        if (!bitmap.tryAllocN32Pixels(w, h)) return;
        SkCanvas canvas(bitmap);
        canvas.clear(SK_ColorTRANSPARENT);

        // We need a temporary container_skia to use its gradient drawing methods,
        // but we can also just use the current one with a different canvas.
        SkCanvas* old_canvas = m_canvas;
        m_canvas = &canvas;

        litehtml::background_layer layer;
        layer.origin_box = litehtml::position(0, 0, w, h);
        layer.border_box = layer.origin_box;
        layer.clip_box = layer.origin_box;

        if (border_image.source.m_gradient.m_type == litehtml::_linear_gradient_ ||
            border_image.source.m_gradient.m_type == litehtml::_repeating_linear_gradient_) {
            auto grad = litehtml::background::get_linear_gradient(border_image.source.m_gradient,
                                                                  layer.origin_box);
            if (grad) draw_linear_gradient(0, layer, *grad);
        } else if (border_image.source.m_gradient.m_type == litehtml::_radial_gradient_ ||
                   border_image.source.m_gradient.m_type == litehtml::_repeating_radial_gradient_) {
            auto grad = litehtml::background::get_radial_gradient(border_image.source.m_gradient,
                                                                  layer.origin_box);
            if (grad) draw_radial_gradient(0, layer, *grad);
        } else if (border_image.source.m_gradient.m_type == litehtml::_conic_gradient_ ||
                   border_image.source.m_gradient.m_type == litehtml::_repeating_conic_gradient_) {
            auto grad = litehtml::background::get_conic_gradient(border_image.source.m_gradient,
                                                                 layer.origin_box);
            if (grad) draw_conic_gradient(0, layer, *grad);
        }

        m_canvas = old_canvas;
        img = bitmap.asImage();
    }

    if (!img) return;
    float img_w = (float)img->width();
    float img_h = (float)img->height();

    // Calculate slice pixel values
    float s_t = border_image.slice[0].calc_percent((int)img_h);
    float s_r = border_image.slice[1].calc_percent((int)img_w);
    float s_b = border_image.slice[2].calc_percent((int)img_h);
    float s_l = border_image.slice[3].calc_percent((int)img_w);

    // border-image-slice values are edges, so they can't exceed image dimensions
    if (s_t + s_b > img_h) {
        float scale = img_h / (s_t + s_b);
        s_t *= scale;
        s_b *= scale;
    }
    if (s_l + s_r > img_w) {
        float scale = img_w / (s_l + s_r);
        s_l *= scale;
        s_r *= scale;
    }

    // Calculate output width pixel values (using border-image-width)
    auto calc_width = [&](const litehtml::css_length& w, int border_w, int total) {
        if (w.is_predefined()) return (float)border_w;
        if (w.units() == litehtml::css_units_none) return w.val() * border_w;
        return (float)w.calc_percent(total);
    };

    float w_t = calc_width(border_image.width[0], borders.top.width, draw_pos.height);
    float w_r = calc_width(border_image.width[1], borders.right.width, draw_pos.width);
    float w_b = calc_width(border_image.width[2], borders.bottom.width, draw_pos.height);
    float w_l = calc_width(border_image.width[3], borders.left.width, draw_pos.width);

    // Calculate outset
    auto calc_outset = [&](const litehtml::css_length& len, int border_w, int total) {
        if (len.units() == litehtml::css_units_none) return len.val() * border_w;
        return (float)len.calc_percent(total);
    };

    float o_t = calc_outset(border_image.outset[0], borders.top.width, draw_pos.height);
    float o_r = calc_outset(border_image.outset[1], borders.right.width, draw_pos.width);
    float o_b = calc_outset(border_image.outset[2], borders.bottom.width, draw_pos.height);
    float o_l = calc_outset(border_image.outset[3], borders.left.width, draw_pos.width);

    SkRect dst_full =
        SkRect::MakeXYWH((float)draw_pos.x - o_l, (float)draw_pos.y - o_t,
                         (float)draw_pos.width + o_l + o_r, (float)draw_pos.height + o_t + o_b);

    // Source rects (9-slice)
    SkRect src[9];
    src[0] = SkRect::MakeXYWH(0, 0, s_l, s_t);                                  // top-left
    src[1] = SkRect::MakeXYWH(s_l, 0, img_w - s_l - s_r, s_t);                  // top
    src[2] = SkRect::MakeXYWH(img_w - s_r, 0, s_r, s_t);                        // top-right
    src[3] = SkRect::MakeXYWH(0, s_t, s_l, img_h - s_t - s_b);                  // left
    src[4] = SkRect::MakeXYWH(s_l, s_t, img_w - s_l - s_r, img_h - s_t - s_b);  // center
    src[5] = SkRect::MakeXYWH(img_w - s_r, s_t, s_r, img_h - s_t - s_b);        // right
    src[6] = SkRect::MakeXYWH(0, img_h - s_b, s_l, s_b);                        // bottom-left
    src[7] = SkRect::MakeXYWH(s_l, img_h - s_b, img_w - s_l - s_r, s_b);        // bottom
    src[8] = SkRect::MakeXYWH(img_w - s_r, img_h - s_b, s_r, s_b);              // bottom-right

    // Destination rects
    SkRect dst[9];
    dst[0] = SkRect::MakeXYWH(dst_full.left(), dst_full.top(), w_l, w_t);
    dst[1] =
        SkRect::MakeXYWH(dst_full.left() + w_l, dst_full.top(), dst_full.width() - w_l - w_r, w_t);
    dst[2] = SkRect::MakeXYWH(dst_full.right() - w_r, dst_full.top(), w_r, w_t);
    dst[3] =
        SkRect::MakeXYWH(dst_full.left(), dst_full.top() + w_t, w_l, dst_full.height() - w_t - w_b);
    dst[4] = SkRect::MakeXYWH(dst_full.left() + w_l, dst_full.top() + w_t,
                              dst_full.width() - w_l - w_r, dst_full.height() - w_t - w_b);
    dst[5] = SkRect::MakeXYWH(dst_full.right() - w_r, dst_full.top() + w_t, w_r,
                              dst_full.height() - w_t - w_b);
    dst[6] = SkRect::MakeXYWH(dst_full.left(), dst_full.bottom() - w_b, w_l, w_b);
    dst[7] = SkRect::MakeXYWH(dst_full.left() + w_l, dst_full.bottom() - w_b,
                              dst_full.width() - w_l - w_r, w_b);
    dst[8] = SkRect::MakeXYWH(dst_full.right() - w_r, dst_full.bottom() - w_b, w_r, w_b);

    SkPaint p;
    p.setAntiAlias(true);
    p.setAlphaf(get_current_opacity());

    auto draw_piece = [&](int idx, litehtml::border_image_repeat rep_h,
                          litehtml::border_image_repeat rep_v) {
        if (src[idx].width() <= 0 || src[idx].height() <= 0 || dst[idx].width() <= 0 ||
            dst[idx].height() <= 0)
            return;

        if (rep_h == litehtml::border_image_repeat_stretch &&
            rep_v == litehtml::border_image_repeat_stretch) {
            m_canvas->drawImageRect(img, src[idx], dst[idx],
                                    SkSamplingOptions(SkFilterMode::kLinear), &p,
                                    SkCanvas::kFast_SrcRectConstraint);
        } else {
            m_canvas->save();
            m_canvas->clipRect(dst[idx]);

            SkTileMode tm_h = (rep_h == litehtml::border_image_repeat_stretch)
                                  ? SkTileMode::kClamp
                                  : SkTileMode::kRepeat;
            SkTileMode tm_v = (rep_v == litehtml::border_image_repeat_stretch)
                                  ? SkTileMode::kClamp
                                  : SkTileMode::kRepeat;

            // Tile size in destination
            float tile_w, tile_h;
            if (idx == 1 || idx == 7) {  // top, bottom
                tile_h = dst[idx].height();
                tile_w = src[idx].width() * (tile_h / src[idx].height());
            } else if (idx == 3 || idx == 5) {  // left, right
                tile_w = dst[idx].width();
                tile_h = src[idx].height() * (tile_w / src[idx].width());
            } else {                                      // center
                tile_w = src[idx].width() * (w_t / s_t);  // use top border width as scale reference
                tile_h = src[idx].height() * (w_l / s_l);
            }

            if (rep_h == litehtml::border_image_repeat_round) {
                int count = (int)std::max(1.0f, std::round(dst[idx].width() / tile_w));
                tile_w = dst[idx].width() / count;
            }
            if (rep_v == litehtml::border_image_repeat_round) {
                int count = (int)std::max(1.0f, std::round(dst[idx].height() / tile_h));
                tile_h = dst[idx].height() / count;
            }

            SkMatrix m;
            m.setScaleTranslate(tile_w / src[idx].width(), tile_h / src[idx].height(),
                                dst[idx].left(), dst[idx].top());
            // Adjust translation for source slice
            m.preTranslate(-src[idx].left(), -src[idx].top());

            p.setShader(img->makeShader(tm_h, tm_v, SkSamplingOptions(SkFilterMode::kLinear), &m));
            m_canvas->drawRect(dst[idx], p);
            p.setShader(nullptr);

            m_canvas->restore();
        }
    };

    // Corners
    for (int i : {0, 2, 6, 8}) {
        draw_piece(i, litehtml::border_image_repeat_stretch, litehtml::border_image_repeat_stretch);
    }

    // Sides
    draw_piece(1, border_image.repeat_h, litehtml::border_image_repeat_stretch);  // top
    draw_piece(7, border_image.repeat_h, litehtml::border_image_repeat_stretch);  // bottom
    draw_piece(3, litehtml::border_image_repeat_stretch, border_image.repeat_v);  // left
    draw_piece(5, litehtml::border_image_repeat_stretch, border_image.repeat_v);  // right

    // Center
    if (border_image.slice_fill) {
        draw_piece(4, border_image.repeat_h, border_image.repeat_v);
    }
}

void container_skia::draw_borders(litehtml::uint_ptr hdc, const litehtml::borders& borders,
                                  const litehtml::position& draw_pos, bool root) {
    if (!m_canvas) return;
    flush();

    bool uniform =
        borders.top.width == borders.bottom.width && borders.top.width == borders.left.width &&
        borders.top.width == borders.right.width && borders.top.color == borders.bottom.color &&
        borders.top.color == borders.left.color && borders.top.color == borders.right.color &&
        borders.top.style == borders.bottom.style && borders.top.style == borders.left.style &&
        borders.top.style == borders.right.style &&
        borders.top.style != litehtml::border_style_groove &&
        borders.top.style != litehtml::border_style_ridge &&
        borders.top.style != litehtml::border_style_inset &&
        borders.top.style != litehtml::border_style_outset;

    if (uniform && borders.top.width > 0) {
        if (borders.top.style == litehtml::border_style_none ||
            borders.top.style == litehtml::border_style_hidden)
            return;

        SkPaint p;
        p.setColor(SkColorSetARGB(borders.top.color.alpha, borders.top.color.red,
                                  borders.top.color.green, borders.top.color.blue));
        p.setAntiAlias(true);

        SkRRect rr = make_rrect(draw_pos, borders.radius);

        if (borders.top.style == litehtml::border_style_dotted ||
            borders.top.style == litehtml::border_style_dashed) {
            p.setStrokeWidth((float)borders.top.width);
            p.setStyle(SkPaint::kStroke_Style);
            float intervals[2];
            if (borders.top.style == litehtml::border_style_dotted) {
                intervals[0] = 0.0f;
                intervals[1] = 2.0f * (float)borders.top.width;
                p.setStrokeCap(SkPaint::kRound_Cap);
            } else {
                intervals[0] = std::max(3.0f, 2.0f * (float)borders.top.width);
                intervals[1] = (float)borders.top.width;
            }
            p.setPathEffect(SkDashPathEffect::Make(SkSpan<const float>(intervals, 2), 0));
            rr.inset((float)borders.top.width / 2.0f, (float)borders.top.width / 2.0f);
            m_canvas->drawRRect(rr, p);
        } else if (borders.top.style == litehtml::border_style_double) {
            p.setStrokeWidth((float)borders.top.width / 3.0f);
            p.setStyle(SkPaint::kStroke_Style);
            SkRRect outer = rr;
            outer.inset((float)borders.top.width / 6.0f, (float)borders.top.width / 6.0f);
            m_canvas->drawRRect(outer, p);
            SkRRect inner = rr;
            inner.inset((float)borders.top.width * 5.0f / 6.0f,
                        (float)borders.top.width * 5.0f / 6.0f);
            m_canvas->drawRRect(inner, p);
        } else {
            p.setStrokeWidth((float)borders.top.width);
            p.setStyle(SkPaint::kStroke_Style);
            rr.inset((float)borders.top.width / 2.0f, (float)borders.top.width / 2.0f);
            m_canvas->drawRRect(rr, p);
        }
    } else {
        float x = (float)draw_pos.x, y = (float)draw_pos.y, w = (float)draw_pos.width,
              h = (float)draw_pos.height, lw = (float)borders.left.width,
              tw = (float)borders.top.width, rw = (float)borders.right.width,
              bw = (float)borders.bottom.width;

        if (lw <= 0 && tw <= 0 && rw <= 0 && bw <= 0) return;

        m_canvas->save();
        SkRRect outer_rr = make_rrect(draw_pos, borders.radius);
        SkPoint center = {x + w / 2.0f, y + h / 2.0f};

        auto draw_side = [&](const litehtml::border& b, const SkPath& quadrant, bool is_top_left,
                             float sw) {
            if (b.width <= 0 || b.style == litehtml::border_style_none ||
                b.style == litehtml::border_style_hidden)
                return;

            m_canvas->save();
            m_canvas->clipPath(quadrant, true);

            SkPaint p;
            p.setAntiAlias(true);
            p.setColor(SkColorSetARGB(b.color.alpha, b.color.red, b.color.green, b.color.blue));

            if (b.style == litehtml::border_style_dotted ||
                b.style == litehtml::border_style_dashed) {
                p.setStyle(SkPaint::kStroke_Style);
                p.setStrokeWidth((float)b.width);
                float intervals[2];
                if (b.style == litehtml::border_style_dotted) {
                    intervals[0] = 0.0f;
                    intervals[1] = 2.0f * (float)b.width;
                    p.setStrokeCap(SkPaint::kRound_Cap);
                } else {
                    intervals[0] = std::max(3.0f, 2.0f * (float)b.width);
                    intervals[1] = (float)b.width;
                }
                p.setPathEffect(SkDashPathEffect::Make(SkSpan<const float>(intervals, 2), 0));
                SkRRect stroke_rr = outer_rr;
                stroke_rr.inset(sw / 2.0f, sw / 2.0f);
                m_canvas->drawRRect(stroke_rr, p);
            } else if (b.style == litehtml::border_style_double) {
                p.setStyle(SkPaint::kStroke_Style);
                p.setStrokeWidth(sw / 3.0f);
                SkRRect r1 = outer_rr;
                r1.inset(sw / 6.0f, sw / 6.0f);
                m_canvas->drawRRect(r1, p);
                SkRRect r2 = outer_rr;
                r2.inset(sw * 5.0f / 6.0f, sw * 5.0f / 6.0f);
                m_canvas->drawRRect(r2, p);
            } else if (b.style == litehtml::border_style_groove ||
                       b.style == litehtml::border_style_ridge) {
                bool ridge = (b.style == litehtml::border_style_ridge);
                SkColor c1, c2;
                if (is_top_left) {
                    c1 = ridge ? lighten(b.color, 0.2f) : darken(b.color, 0.2f);
                    c2 = ridge ? darken(b.color, 0.2f) : lighten(b.color, 0.2f);
                } else {
                    c1 = ridge ? darken(b.color, 0.2f) : lighten(b.color, 0.2f);
                    c2 = ridge ? lighten(b.color, 0.2f) : darken(b.color, 0.2f);
                }
                SkRRect r1 = outer_rr;
                SkRRect r2 = outer_rr;
                r2.inset(sw / 2.0f, sw / 2.0f);
                SkRRect r3 = outer_rr;
                r3.inset(sw, sw);

                SkPath p1 =
                    SkPathBuilder().addRRect(r1).addRRect(r2, SkPathDirection::kCCW).detach();
                SkPath p2 =
                    SkPathBuilder().addRRect(r2).addRRect(r3, SkPathDirection::kCCW).detach();

                p.setColor(c1);
                m_canvas->drawPath(p1, p);
                p.setColor(c2);
                m_canvas->drawPath(p2, p);
            } else {
                if (b.style == litehtml::border_style_inset ||
                    b.style == litehtml::border_style_outset) {
                    bool outset = (b.style == litehtml::border_style_outset);
                    if (is_top_left) {
                        p.setColor(outset ? lighten(b.color, 0.2f) : darken(b.color, 0.2f));
                    } else {
                        p.setColor(outset ? darken(b.color, 0.2f) : lighten(b.color, 0.2f));
                    }
                }
                SkRect ir = SkRect::MakeXYWH(x + lw, y + tw, w - lw - rw, h - tw - bw);
                SkRRect inner_rr;
                if (ir.width() > 0 && ir.height() > 0) {
                    SkVector rads[4] = {{std::max(0.0f, (float)borders.radius.top_left_x - lw),
                                         std::max(0.0f, (float)borders.radius.top_left_y - tw)},
                                        {std::max(0.0f, (float)borders.radius.top_right_x - rw),
                                         std::max(0.0f, (float)borders.radius.top_right_y - tw)},
                                        {std::max(0.0f, (float)borders.radius.bottom_right_x - rw),
                                         std::max(0.0f, (float)borders.radius.bottom_right_y - bw)},
                                        {std::max(0.0f, (float)borders.radius.bottom_left_x - lw),
                                         std::max(0.0f, (float)borders.radius.bottom_left_y - bw)}};
                    inner_rr.setRectRadii(ir, rads);

                    SkPath path = SkPathBuilder()
                                      .addRRect(outer_rr)
                                      .addRRect(inner_rr, SkPathDirection::kCCW)
                                      .detach();
                    m_canvas->drawPath(path, p);
                } else
                    m_canvas->drawRRect(outer_rr, p);
            }
            m_canvas->restore();
        };

        draw_side(borders.top,
                  SkPathBuilder()
                      .moveTo(x, y)
                      .lineTo(x + w, y)
                      .lineTo(x + w - rw, y + tw)
                      .lineTo(center.fX, center.fY)
                      .lineTo(x + lw, y + tw)
                      .close()
                      .detach(),
                  true, tw);
        draw_side(borders.bottom,
                  SkPathBuilder()
                      .moveTo(x, y + h)
                      .lineTo(x + w, y + h)
                      .lineTo(x + w - rw, y + h - bw)
                      .lineTo(center.fX, center.fY)
                      .lineTo(x + lw, y + h - bw)
                      .close()
                      .detach(),
                  false, bw);
        draw_side(borders.left,
                  SkPathBuilder()
                      .moveTo(x, y)
                      .lineTo(x + lw, y + tw)
                      .lineTo(center.fX, center.fY)
                      .lineTo(x + lw, y + h - bw)
                      .lineTo(x, y + h)
                      .close()
                      .detach(),
                  true, lw);
        draw_side(borders.right,
                  SkPathBuilder()
                      .moveTo(x + w, y)
                      .lineTo(x + w - rw, y + tw)
                      .lineTo(center.fX, center.fY)
                      .lineTo(x + w - rw, y + h - bw)
                      .lineTo(x + w, y + h)
                      .close()
                      .detach(),
                  false, rw);

        m_canvas->restore();
    }
}

// ── draw_list_marker (container_skia.cpp misc領域から移動, P4) ──
void container_skia::draw_list_marker(litehtml::uint_ptr hdc, const litehtml::list_marker& marker) {
    if (!m_canvas) return;
    flush();

    if (!marker.image.empty()) {
        std::string url = marker.image;
        auto it = m_context.imageCache.find(url);
        if (it != m_context.imageCache.end() && it->second.skImage) {
            SkRect dst = SkRect::MakeXYWH((float)marker.pos.x, (float)marker.pos.y,
                                          (float)marker.pos.width, (float)marker.pos.height);
            SkPaint p;
            p.setAntiAlias(true);
            if (m_tagging) {
                image_draw_info draw;
                draw.url = url;
                litehtml::background_layer layer;
                layer.border_box = marker.pos;
                layer.clip_box = marker.pos;
                layer.origin_box = marker.pos;
                draw.layer = layer;
                draw.opacity = get_current_opacity();
                m_paint.imageDraws.push_back(draw);
                int index = (int)m_paint.imageDraws.size();
                p.setColor(make_magic_color(satoru::MagicTagExtended::ImageDraw, index));
                m_canvas->drawRect(dst, p);
            } else {
                m_canvas->drawImageRect(it->second.skImage, dst,
                                        SkSamplingOptions(SkFilterMode::kLinear), &p);
            }
        }
        return;
    }

    SkPaint paint;
    paint.setAntiAlias(true);
    litehtml::web_color color = marker.color;
    paint.setColor(SkColorSetARGB(color.alpha, color.red, color.green, color.blue));

    SkRect rect = SkRect::MakeXYWH((float)marker.pos.x, (float)marker.pos.y,
                                   (float)marker.pos.width, (float)marker.pos.height);

    switch (marker.marker_type) {
        case litehtml::list_style_type_circle: {
            paint.setStyle(SkPaint::kStroke_Style);
            float strokeWidth = std::max(1.0f, (float)marker.pos.width * 0.1f);
            paint.setStrokeWidth(strokeWidth);
            rect.inset(strokeWidth / 2.0f, strokeWidth / 2.0f);
            m_canvas->drawOval(rect, paint);
            break;
        }
        case litehtml::list_style_type_disc: {
            paint.setStyle(SkPaint::kFill_Style);
            m_canvas->drawOval(rect, paint);
            break;
        }
        case litehtml::list_style_type_square: {
            paint.setStyle(SkPaint::kFill_Style);
            m_canvas->drawRect(rect, paint);
            break;
        }
        default:
            break;
    }
}
