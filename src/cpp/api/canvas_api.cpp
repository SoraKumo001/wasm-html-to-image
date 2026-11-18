#include "canvas_api.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include <litehtml/css_parser.h>
#include <litehtml/css_tokenizer.h>
#include <litehtml/web_color.h>

#include "../common/image_decoder.h"
#include "../common/skia_encode.h"
#include "../core/container_skia_helpers.h"
#include "../core/image_converter_context.h"
#include "converter_api.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkImage.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRRect.h"
#include "include/core/SkRect.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/effects/SkGradient.h"
#include "include/effects/SkImageFilters.h"
#include "include/utils/SkParsePath.h"
#include "unified_api.h"

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 2.0f * kPi;

static bool parse_css_color(const std::string& str, SkColor& out) {
    if (str.empty()) return false;
    litehtml::css_token_vector tokens = litehtml::tokenize(str);
    tokens = litehtml::normalize(tokens, litehtml::f_componentize | litehtml::f_remove_whitespace);
    if (tokens.size() != 1) return false;
    litehtml::web_color wc;
    if (!litehtml::parse_color(tokens[0], wc, nullptr)) return false;
    out = SkColorSetARGB(wc.alpha, wc.red, wc.green, wc.blue);
    return true;
}

static sk_sp<SkImageFilter> parse_css_filter_string(const std::string& str) {
    if (str.empty() || str == "none") return nullptr;
    litehtml::css_token_vector tokens = litehtml::tokenize(str);
    tokens = litehtml::normalize(tokens, litehtml::f_componentize | litehtml::f_remove_whitespace);
    if (tokens.empty()) return nullptr;

    // build_backdrop_filter_chain handles blur, brightness, contrast, grayscale,
    // sepia, saturate, hue-rotate, invert, opacity.
    // build_filter_chain handles blur and drop-shadow.
    // Split tokens by whether they are drop-shadow or others so we don't apply blur twice.
    litehtml::css_token_vector general_tokens;
    litehtml::css_token_vector drop_shadow_tokens;
    for (const auto& tok : tokens) {
        if (tok.type == litehtml::CV_FUNCTION && litehtml::lowcase(tok.name) == "drop-shadow") {
            drop_shadow_tokens.push_back(tok);
        } else {
            general_tokens.push_back(tok);
        }
    }

    sk_sp<SkImageFilter> f1 =
        general_tokens.empty() ? nullptr : build_backdrop_filter_chain(general_tokens);
    sk_sp<SkImageFilter> f2 =
        drop_shadow_tokens.empty() ? nullptr : build_filter_chain(drop_shadow_tokens);
    if (f1 && f2) return SkImageFilters::Compose(f2, f1);
    return f1 ? f1 : f2;
}

static SkBlendMode parse_blend_mode(const std::string& op) {
    if (op == "source-over") return SkBlendMode::kSrcOver;
    if (op == "source-in") return SkBlendMode::kSrcIn;
    if (op == "source-out") return SkBlendMode::kSrcOut;
    if (op == "source-atop") return SkBlendMode::kSrcATop;
    if (op == "destination-over") return SkBlendMode::kDstOver;
    if (op == "destination-in") return SkBlendMode::kDstIn;
    if (op == "destination-out") return SkBlendMode::kDstOut;
    if (op == "destination-atop") return SkBlendMode::kDstATop;
    if (op == "lighter") return SkBlendMode::kPlus;
    if (op == "copy") return SkBlendMode::kSrc;
    if (op == "xor") return SkBlendMode::kXor;
    if (op == "multiply") return SkBlendMode::kMultiply;
    if (op == "screen") return SkBlendMode::kScreen;
    if (op == "overlay") return SkBlendMode::kOverlay;
    if (op == "darken") return SkBlendMode::kDarken;
    if (op == "lighten") return SkBlendMode::kLighten;
    if (op == "color-dodge") return SkBlendMode::kColorDodge;
    if (op == "color-burn") return SkBlendMode::kColorBurn;
    if (op == "hard-light") return SkBlendMode::kHardLight;
    if (op == "soft-light") return SkBlendMode::kSoftLight;
    if (op == "difference") return SkBlendMode::kDifference;
    if (op == "exclusion") return SkBlendMode::kExclusion;
    if (op == "hue") return SkBlendMode::kHue;
    if (op == "saturation") return SkBlendMode::kSaturation;
    if (op == "color") return SkBlendMode::kColor;
    if (op == "luminosity") return SkBlendMode::kLuminosity;
    return SkBlendMode::kSrcOver;
}

static void append_arc_to_builder(SkPathBuilder& builder, float cx, float cy, float rx, float ry,
                                  float rotation_rad, float start_angle, float end_angle,
                                  bool ccw) {
    if (rx <= 0.0f || ry <= 0.0f) return;

    float sweep = end_angle - start_angle;
    if (!ccw && sweep >= kTwoPi) {
        sweep = kTwoPi;
    } else if (ccw && sweep <= -kTwoPi) {
        sweep = -kTwoPi;
    } else {
        sweep = std::fmod(sweep, kTwoPi);
        if (!ccw && sweep < 0.0f) sweep += kTwoPi;
        if (ccw && sweep > 0.0f) sweep -= kTwoPi;
        if (sweep == 0.0f && start_angle != end_angle) {
            sweep = ccw ? -kTwoPi : kTwoPi;
        }
    }

    auto point_at = [&](float angle) -> SkPoint {
        float lx = rx * std::cos(angle);
        float ly = ry * std::sin(angle);
        if (rotation_rad == 0.0f) {
            return SkPoint::Make(cx + lx, cy + ly);
        }
        float c = std::cos(rotation_rad);
        float s = std::sin(rotation_rad);
        return SkPoint::Make(cx + lx * c - ly * s, cy + lx * s + ly * c);
    };

    SkPoint start_pt = point_at(start_angle);
    if (builder.isEmpty()) {
        builder.moveTo(start_pt);
    } else {
        builder.lineTo(start_pt);
    }

    if (std::abs(sweep) < 1e-6f) return;

    // Split into <= 90-degree (pi/2) cubic Bezier segments
    int segs = std::max(1, (int)std::ceil(std::abs(sweep) / (kPi * 0.5f)));
    float seg_angle = sweep / (float)segs;
    float alpha = (4.0f / 3.0f) * std::tan(seg_angle * 0.25f);

    float cos_rot = rotation_rad == 0.0f ? 1.0f : std::cos(rotation_rad);
    float sin_rot = rotation_rad == 0.0f ? 0.0f : std::sin(rotation_rad);

    auto transform_pt = [&](float lx, float ly) -> SkPoint {
        return SkPoint::Make(cx + lx * cos_rot - ly * sin_rot,
                             cy + lx * sin_rot + ly * cos_rot);
    };

    float cur = start_angle;
    for (int i = 0; i < segs; ++i) {
        float next = cur + seg_angle;
        float c1 = std::cos(cur);
        float s1 = std::sin(cur);
        float c2 = std::cos(next);
        float s2 = std::sin(next);

        SkPoint cp1 = transform_pt(rx * (c1 - alpha * s1), ry * (s1 + alpha * c1));
        SkPoint cp2 = transform_pt(rx * (c2 + alpha * s2), ry * (s2 - alpha * c2));
        SkPoint end_pt = transform_pt(rx * c2, ry * s2);
        builder.cubicTo(cp1, cp2, end_pt);
        cur = next;
    }
}

static bool build_gradient_stops(const double* args, size_t& idx, size_t arg_count,
                                 const std::vector<std::string>& strings, size_t& str_idx,
                                 std::vector<SkColor4f>& out_colors,
                                 std::vector<float>& out_positions) {
    if (idx >= arg_count) return false;
    int stop_count = (int)args[idx++];
    if (stop_count <= 0 || idx + (size_t)stop_count > arg_count ||
        str_idx + (size_t)stop_count > strings.size()) {
        return false;
    }
    struct Stop {
        float pos;
        SkColor4f color;
    };
    std::vector<Stop> stops;
    stops.reserve((size_t)stop_count);
    for (int i = 0; i < stop_count; ++i) {
        float p = (float)args[idx++];
        SkColor c = SK_ColorBLACK;
        parse_css_color(strings[str_idx++], c);
        stops.push_back({std::clamp(p, 0.0f, 1.0f), SkColor4f::FromColor(c)});
    }
    std::stable_sort(stops.begin(), stops.end(),
                     [](const Stop& a, const Stop& b) { return a.pos < b.pos; });
    out_colors.reserve(stops.size());
    out_positions.reserve(stops.size());
    for (const auto& s : stops) {
        out_colors.push_back(s.color);
        out_positions.push_back(s.pos);
    }
    return true;
}

}  // namespace

CanvasInstance::CanvasInstance(int width, int height) {
    static bool codecs_registered = false;
    if (!codecs_registered) {
        ImageConverterContext ctx;
        ctx.init();
        codecs_registered = true;
    }
    resize(width, height);
}

CanvasInstance::~CanvasInstance() = default;

bool CanvasInstance::resize(int width, int height) {
    if (width <= 0 || height <= 0) return false;
    SkBitmap next;
    if (!next.tryAllocN32Pixels(width, height)) return false;
    next.eraseColor(SK_ColorTRANSPARENT);
    bitmap = std::move(next);
    canvas = std::make_unique<SkCanvas>(bitmap);
    state_stack.clear();
    current_state = CanvasState();
    path_builder.reset();
    return true;
}

SkSamplingOptions CanvasInstance::current_sampling() const {
    if (!current_state.image_smoothing_enabled) {
        return SkSamplingOptions(SkFilterMode::kNearest, SkMipmapMode::kNone);
    }
    if (current_state.image_smoothing_quality >= 2) {
        return SkSamplingOptions(SkCubicResampler::Mitchell());
    }
    return SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone);
}

SkPaint CanvasInstance::build_paint(bool is_stroke) const {
    SkPaint paint;
    paint.setAntiAlias(true);
    paint.setBlendMode(current_state.blend_mode);

    const CanvasPaintStyle& style =
        is_stroke ? current_state.stroke_style : current_state.fill_style;
    if (style.is_shader && style.shader) {
        paint.setShader(style.shader);
        paint.setAlphaf(std::clamp(current_state.global_alpha, 0.0f, 1.0f));
    } else {
        SkColor4f c = SkColor4f::FromColor(style.color);
        c.fA *= std::clamp(current_state.global_alpha, 0.0f, 1.0f);
        paint.setColor(c);
    }

    if (is_stroke) {
        paint.setStyle(SkPaint::kStroke_Style);
        paint.setStrokeWidth(current_state.line_width);
        paint.setStrokeCap(current_state.line_cap);
        paint.setStrokeJoin(current_state.line_join);
        paint.setStrokeMiter(current_state.miter_limit);
        if (!current_state.line_dash.empty()) {
            paint.setPathEffect(SkDashPathEffect::Make(current_state.line_dash,
                                                       current_state.line_dash_offset));
        }
    } else {
        paint.setStyle(SkPaint::kFill_Style);
    }

    sk_sp<SkImageFilter> img_filter = current_state.filter;
    uint8_t shadow_a = SkColorGetA(current_state.shadow_color);
    if (shadow_a > 0 &&
        (current_state.shadow_blur > 0.0f || current_state.shadow_offset_x != 0.0f ||
         current_state.shadow_offset_y != 0.0f)) {
        float dx = current_state.shadow_offset_x;
        float dy = current_state.shadow_offset_y;
        if (canvas) {
            SkMatrix inv;
            if (canvas->getTotalMatrix().invert(&inv)) {
                SkVector v = inv.mapVector(dx, dy);
                dx = v.x();
                dy = v.y();
            }
        }
        float sigma = std::max(0.0f, current_state.shadow_blur * 0.5f);
        sk_sp<SkImageFilter> shadow_filter = SkImageFilters::DropShadow(
            dx, dy, sigma, sigma, current_state.shadow_color, img_filter);
        img_filter = shadow_filter;
    }
    if (img_filter) {
        paint.setImageFilter(std::move(img_filter));
    }

    return paint;
}

bool CanvasInstance::exec_batch(const uint8_t* ops, size_t op_count, const double* args,
                                size_t arg_count, const std::vector<std::string>& strings) {
    if (!canvas) return false;
    size_t idx = 0;
    size_t str_idx = 0;

    auto need_args = [&](size_t n) -> bool { return idx + n <= arg_count; };
    auto need_strs = [&](size_t n) -> bool { return str_idx + n <= strings.size(); };

    for (size_t i = 0; i < op_count; ++i) {
        CanvasOp op = static_cast<CanvasOp>(ops[i]);
        switch (op) {
            case CanvasOp::Save:
                state_stack.push_back(current_state);
                canvas->save();
                break;
            case CanvasOp::Restore:
                if (!state_stack.empty()) {
                    current_state = std::move(state_stack.back());
                    state_stack.pop_back();
                    canvas->restore();
                }
                break;
            case CanvasOp::Translate:
                if (!need_args(2)) return false;
                canvas->translate((float)args[idx], (float)args[idx + 1]);
                idx += 2;
                break;
            case CanvasOp::Scale:
                if (!need_args(2)) return false;
                canvas->scale((float)args[idx], (float)args[idx + 1]);
                idx += 2;
                break;
            case CanvasOp::Rotate:
                if (!need_args(1)) return false;
                canvas->rotate((float)(args[idx++] * (180.0 / kPi)));
                break;
            case CanvasOp::Transform: {
                if (!need_args(6)) return false;
                SkMatrix m = SkMatrix::MakeAll((float)args[idx], (float)args[idx + 2],
                                               (float)args[idx + 4], (float)args[idx + 1],
                                               (float)args[idx + 3], (float)args[idx + 5], 0, 0, 1);
                canvas->concat(m);
                idx += 6;
                break;
            }
            case CanvasOp::SetTransform: {
                if (!need_args(6)) return false;
                SkMatrix m = SkMatrix::MakeAll((float)args[idx], (float)args[idx + 2],
                                               (float)args[idx + 4], (float)args[idx + 1],
                                               (float)args[idx + 3], (float)args[idx + 5], 0, 0, 1);
                canvas->setMatrix(m);
                idx += 6;
                break;
            }
            case CanvasOp::ResetTransform:
                canvas->resetMatrix();
                break;
            case CanvasOp::ClipRect: {
                if (!need_args(4)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                canvas->clipRect(r, SkClipOp::kIntersect, true);
                idx += 4;
                break;
            }
            case CanvasOp::ClipPath: {
                if (!need_args(1)) return false;
                int fill_rule = (int)args[idx++];
                SkPath p = path_builder.snapshot();
                p.setFillType(fill_rule == 1 ? SkPathFillType::kEvenOdd
                                             : SkPathFillType::kWinding);
                canvas->clipPath(p, SkClipOp::kIntersect, true);
                break;
            }
            case CanvasOp::FillRect: {
                if (!need_args(4)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                idx += 4;
                canvas->drawRect(r, build_paint(false));
                break;
            }
            case CanvasOp::StrokeRect: {
                if (!need_args(4)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                idx += 4;
                canvas->drawRect(r, build_paint(true));
                break;
            }
            case CanvasOp::ClearRect: {
                if (!need_args(4)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                idx += 4;
                SkPaint clear_paint;
                clear_paint.setBlendMode(SkBlendMode::kClear);
                canvas->drawRect(r, clear_paint);
                break;
            }
            case CanvasOp::BeginPath:
                path_builder.reset();
                break;
            case CanvasOp::ClosePath:
                path_builder.close();
                break;
            case CanvasOp::MoveTo:
                if (!need_args(2)) return false;
                path_builder.moveTo((float)args[idx], (float)args[idx + 1]);
                idx += 2;
                break;
            case CanvasOp::LineTo:
                if (!need_args(2)) return false;
                path_builder.lineTo((float)args[idx], (float)args[idx + 1]);
                idx += 2;
                break;
            case CanvasOp::QuadraticCurveTo:
                if (!need_args(4)) return false;
                path_builder.quadTo((float)args[idx], (float)args[idx + 1], (float)args[idx + 2],
                                    (float)args[idx + 3]);
                idx += 4;
                break;
            case CanvasOp::BezierCurveTo:
                if (!need_args(6)) return false;
                path_builder.cubicTo((float)args[idx], (float)args[idx + 1], (float)args[idx + 2],
                                     (float)args[idx + 3], (float)args[idx + 4],
                                     (float)args[idx + 5]);
                idx += 6;
                break;
            case CanvasOp::Arc: {
                if (!need_args(6)) return false;
                float cx = (float)args[idx];
                float cy = (float)args[idx + 1];
                float r = (float)args[idx + 2];
                float sa = (float)args[idx + 3];
                float ea = (float)args[idx + 4];
                bool ccw = args[idx + 5] != 0.0;
                idx += 6;
                append_arc_to_builder(path_builder, cx, cy, r, r, 0.0f, sa, ea, ccw);
                break;
            }
            case CanvasOp::ArcTo: {
                if (!need_args(5)) return false;
                float x1 = (float)args[idx];
                float y1 = (float)args[idx + 1];
                float x2 = (float)args[idx + 2];
                float y2 = (float)args[idx + 3];
                float r = (float)args[idx + 4];
                idx += 5;
                path_builder.arcTo(SkPoint::Make(x1, y1), SkPoint::Make(x2, y2), r);
                break;
            }
            case CanvasOp::Ellipse: {
                if (!need_args(8)) return false;
                float cx = (float)args[idx];
                float cy = (float)args[idx + 1];
                float rx = (float)args[idx + 2];
                float ry = (float)args[idx + 3];
                float rot = (float)args[idx + 4];
                float sa = (float)args[idx + 5];
                float ea = (float)args[idx + 6];
                bool ccw = args[idx + 7] != 0.0;
                idx += 8;
                append_arc_to_builder(path_builder, cx, cy, rx, ry, rot, sa, ea, ccw);
                break;
            }
            case CanvasOp::Rect: {
                if (!need_args(4)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                idx += 4;
                path_builder.addRect(r);
                break;
            }
            case CanvasOp::RoundRect: {
                if (!need_args(12)) return false;
                SkRect r = SkRect::MakeXYWH((float)args[idx], (float)args[idx + 1],
                                            (float)args[idx + 2], (float)args[idx + 3]);
                SkVector radii[4] = {
                    {(float)args[idx + 4], (float)args[idx + 5]},
                    {(float)args[idx + 6], (float)args[idx + 7]},
                    {(float)args[idx + 8], (float)args[idx + 9]},
                    {(float)args[idx + 10], (float)args[idx + 11]},
                };
                idx += 12;
                SkRRect rr;
                rr.setRectRadii(r, radii);
                path_builder.addRRect(rr);
                break;
            }
            case CanvasOp::Fill: {
                if (!need_args(1)) return false;
                int fill_rule = (int)args[idx++];
                SkPath p = path_builder.snapshot();
                p.setFillType(fill_rule == 1 ? SkPathFillType::kEvenOdd
                                             : SkPathFillType::kWinding);
                canvas->drawPath(p, build_paint(false));
                break;
            }
            case CanvasOp::Stroke: {
                SkPath p = path_builder.snapshot();
                canvas->drawPath(p, build_paint(true));
                break;
            }
            case CanvasOp::SetFillColor:
            case CanvasOp::SetStrokeColor: {
                if (!need_strs(1)) return false;
                SkColor c = SK_ColorBLACK;
                if (parse_css_color(strings[str_idx++], c)) {
                    CanvasPaintStyle& target = (op == CanvasOp::SetFillColor)
                                                   ? current_state.fill_style
                                                   : current_state.stroke_style;
                    target.is_shader = false;
                    target.color = c;
                    target.shader.reset();
                }
                break;
            }
            case CanvasOp::SetFillLinearGradient:
            case CanvasOp::SetStrokeLinearGradient: {
                if (!need_args(4)) return false;
                SkPoint pts[2] = {SkPoint::Make((float)args[idx], (float)args[idx + 1]),
                                  SkPoint::Make((float)args[idx + 2], (float)args[idx + 3])};
                idx += 4;
                std::vector<SkColor4f> colors;
                std::vector<float> pos;
                if (!build_gradient_stops(args, idx, arg_count, strings, str_idx, colors, pos)) {
                    return false;
                }
                SkGradient grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                                SkGradient::Interpolation());
                CanvasPaintStyle& target = (op == CanvasOp::SetFillLinearGradient)
                                               ? current_state.fill_style
                                               : current_state.stroke_style;
                target.is_shader = true;
                target.shader = SkShaders::LinearGradient(pts, grad);
                break;
            }
            case CanvasOp::SetFillRadialGradient:
            case CanvasOp::SetStrokeRadialGradient: {
                if (!need_args(6)) return false;
                SkPoint c0 = SkPoint::Make((float)args[idx], (float)args[idx + 1]);
                float r0 = (float)args[idx + 2];
                SkPoint c1 = SkPoint::Make((float)args[idx + 3], (float)args[idx + 4]);
                float r1 = (float)args[idx + 5];
                idx += 6;
                std::vector<SkColor4f> colors;
                std::vector<float> pos;
                if (!build_gradient_stops(args, idx, arg_count, strings, str_idx, colors, pos)) {
                    return false;
                }
                SkGradient grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                                SkGradient::Interpolation());
                CanvasPaintStyle& target = (op == CanvasOp::SetFillRadialGradient)
                                               ? current_state.fill_style
                                               : current_state.stroke_style;
                target.is_shader = true;
                target.shader = SkShaders::TwoPointConicalGradient(c0, r0, c1, r1, grad);
                break;
            }
            case CanvasOp::SetFillConicGradient:
            case CanvasOp::SetStrokeConicGradient: {
                if (!need_args(3)) return false;
                float start_angle_rad = (float)args[idx];
                SkPoint center = SkPoint::Make((float)args[idx + 1], (float)args[idx + 2]);
                idx += 3;
                std::vector<SkColor4f> colors;
                std::vector<float> pos;
                if (!build_gradient_stops(args, idx, arg_count, strings, str_idx, colors, pos)) {
                    return false;
                }
                SkGradient grad(SkGradient::Colors(SkSpan(colors), SkSpan(pos), SkTileMode::kClamp),
                                SkGradient::Interpolation());
                SkMatrix m;
                m.setRotate(start_angle_rad * (180.0f / kPi), center.x(), center.y());
                CanvasPaintStyle& target = (op == CanvasOp::SetFillConicGradient)
                                               ? current_state.fill_style
                                               : current_state.stroke_style;
                target.is_shader = true;
                target.shader = SkShaders::SweepGradient(center, grad, &m);
                break;
            }
            case CanvasOp::SetLineWidth:
                if (!need_args(1)) return false;
                if (args[idx] > 0.0) current_state.line_width = (float)args[idx];
                idx++;
                break;
            case CanvasOp::SetLineCap:
                if (!need_args(1)) return false;
                {
                    int cap = (int)args[idx++];
                    current_state.line_cap =
                        cap == 1 ? SkPaint::kRound_Cap
                                 : (cap == 2 ? SkPaint::kSquare_Cap : SkPaint::kButt_Cap);
                }
                break;
            case CanvasOp::SetLineJoin:
                if (!need_args(1)) return false;
                {
                    int join = (int)args[idx++];
                    current_state.line_join =
                        join == 1 ? SkPaint::kRound_Join
                                  : (join == 2 ? SkPaint::kBevel_Join : SkPaint::kMiter_Join);
                }
                break;
            case CanvasOp::SetMiterLimit:
                if (!need_args(1)) return false;
                if (args[idx] > 0.0) current_state.miter_limit = (float)args[idx];
                idx++;
                break;
            case CanvasOp::SetLineDash: {
                if (!need_args(1)) return false;
                int count = (int)args[idx++];
                if (count < 0 || !need_args((size_t)count)) return false;
                current_state.line_dash.clear();
                current_state.line_dash.reserve((size_t)count);
                for (int k = 0; k < count; ++k) {
                    current_state.line_dash.push_back((float)args[idx++]);
                }
                break;
            }
            case CanvasOp::SetLineDashOffset:
                if (!need_args(1)) return false;
                current_state.line_dash_offset = (float)args[idx++];
                break;
            case CanvasOp::SetGlobalAlpha:
                if (!need_args(1)) return false;
                {
                    float a = (float)args[idx++];
                    if (a >= 0.0f && a <= 1.0f) current_state.global_alpha = a;
                }
                break;
            case CanvasOp::SetBlendMode:
                if (!need_strs(1)) return false;
                current_state.blend_mode = parse_blend_mode(strings[str_idx++]);
                break;
            case CanvasOp::SetShadow: {
                if (!need_args(3) || !need_strs(1)) return false;
                current_state.shadow_blur = std::max(0.0f, (float)args[idx]);
                current_state.shadow_offset_x = (float)args[idx + 1];
                current_state.shadow_offset_y = (float)args[idx + 2];
                idx += 3;
                SkColor sc = SK_ColorTRANSPARENT;
                parse_css_color(strings[str_idx++], sc);
                current_state.shadow_color = sc;
                break;
            }
            case CanvasOp::SetFilter:
                if (!need_strs(1)) return false;
                current_state.filter = parse_css_filter_string(strings[str_idx++]);
                break;
            case CanvasOp::SetImageSmoothing:
                if (!need_args(2)) return false;
                current_state.image_smoothing_enabled = args[idx] != 0.0;
                current_state.image_smoothing_quality = (int)args[idx + 1];
                idx += 2;
                break;
            case CanvasOp::AddSvgPath: {
                if (!need_strs(1)) return false;
                SkPath svg_path;
                if (SkParsePath::FromSVGString(strings[str_idx++].c_str(), &svg_path)) {
                    path_builder.addPath(svg_path);
                }
                break;
            }
            default:
                return false;
        }
    }
    return true;
}

bool CanvasInstance::draw_sk_image(const sk_sp<SkImage>& img, double sx, double sy, double sw,
                                   double sh, double dx, double dy, double dw, double dh,
                                   bool has_src_rect) {
    if (!canvas || !img) return false;
    SkPaint paint = build_paint(false);
    SkSamplingOptions sampling = current_sampling();

    if (!has_src_rect) {
        if (dw > 0 && dh > 0) {
            canvas->drawImageRect(img, SkRect::MakeXYWH((float)dx, (float)dy, (float)dw, (float)dh),
                                  sampling, &paint);
        } else {
            canvas->drawImage(img, (float)dx, (float)dy, sampling, &paint);
        }
    } else {
        SkRect src_rect = SkRect::MakeXYWH((float)sx, (float)sy, (float)sw, (float)sh);
        SkRect dst_rect = SkRect::MakeXYWH((float)dx, (float)dy, (float)dw, (float)dh);
        canvas->drawImageRect(img, src_rect, dst_rect, sampling, &paint,
                              SkCanvas::kFast_SrcRectConstraint);
    }
    return true;
}

bool CanvasInstance::draw_image_bytes(const uint8_t* data, size_t size, double sx, double sy,
                                      double sw, double sh, double dx, double dy, double dw,
                                      double dh, bool has_src_rect) {
    if (!canvas || !data || size == 0) return false;
    auto decoded = html_to_image::ImageDecoder::decode(data, size, nullptr);
    if (!decoded.ok() || decoded.frames.empty()) return false;
    sk_sp<SkImage> img = decoded.frames[0].bitmap.asImage();
    return draw_sk_image(img, sx, sy, sw, sh, dx, dy, dw, dh, has_src_rect);
}

bool CanvasInstance::draw_converter(ImageConverterInstance* src, int frame_index, double sx,
                                    double sy, double sw, double sh, double dx, double dy,
                                    double dw, double dh, bool has_src_rect) {
    if (!canvas || !src || src->frames.empty()) return false;
    if (frame_index < 0 || (size_t)frame_index >= src->frames.size()) frame_index = 0;
    sk_sp<SkImage> img = src->frames[(size_t)frame_index].bitmap.asImage();
    return draw_sk_image(img, sx, sy, sw, sh, dx, dy, dw, dh, has_src_rect);
}

bool CanvasInstance::draw_canvas(CanvasInstance* src, double sx, double sy, double sw, double sh,
                                 double dx, double dy, double dw, double dh, bool has_src_rect) {
    if (!canvas || !src) return false;
    sk_sp<SkImage> img = src->bitmap.asImage();
    return draw_sk_image(img, sx, sy, sw, sh, dx, dy, dw, dh, has_src_rect);
}

bool CanvasInstance::get_image_data(int x, int y, int w, int h,
                                    std::vector<uint8_t>& out_rgba) const {
    if (w <= 0 || h <= 0 || bitmap.drawsNothing()) return false;
    size_t byte_len = (size_t)w * (size_t)h * 4;
    out_rgba.assign(byte_len, 0);
    SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
    return bitmap.readPixels(info, out_rgba.data(), (size_t)w * 4, x, y);
}

bool CanvasInstance::put_image_data(const uint8_t* rgba, size_t byte_len, int x, int y, int w,
                                    int h) {
    if (!rgba || w <= 0 || h <= 0 || bitmap.drawsNothing()) return false;
    size_t expected = (size_t)w * (size_t)h * 4;
    if (byte_len < expected) return false;
    SkImageInfo info = SkImageInfo::Make(w, h, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
    SkPixmap pixmap(info, rgba, (size_t)w * 4);
    return bitmap.writePixels(pixmap, x, y);
}

bool CanvasInstance::to_converter(ImageConverterInstance* dst) const {
    if (!dst || bitmap.drawsNothing()) return false;
    SkBitmap copy;
    if (!copy.tryAllocPixels(bitmap.info())) return false;
    if (!bitmap.readPixels(copy.pixmap(), 0, 0)) return false;

    dst->frames.clear();
    dst->raw_data = nullptr;
    dst->original_data = nullptr;
    dst->original_width = copy.width();
    dst->original_height = copy.height();
    dst->original_animation = false;
    dst->original_format = "png";
    ConverterImageFrame frame;
    frame.bitmap = std::move(copy);
    dst->frames.push_back(std::move(frame));
    return true;
}

const uint8_t* CanvasInstance::encode(RenderFormat format, float quality, int speed, int& out_size) {
    out_size = 0;
    last_encoded.reset();
    if (bitmap.drawsNothing()) return nullptr;

    if (format == RenderFormat::SVG) {
        std::string svg = html_to_image::encode_image_to_svg(bitmap);
        if (svg.empty()) return nullptr;
        last_encoded = SkData::MakeWithCopy(svg.data(), svg.size());
        out_size = (int)last_encoded->size();
        return last_encoded->bytes();
    }
    if (format == RenderFormat::PDF) {
        last_encoded = html_to_image::encode_image_to_pdf(bitmap);
        if (!last_encoded) return nullptr;
        out_size = (int)last_encoded->size();
        return last_encoded->bytes();
    }

    ConverterEncodeOptions opts;
    opts.format = format;
    opts.quality = quality;
    opts.speed = speed;
    opts.animation = false;
    html_to_image::EncodeResult res = html_to_image::render_bitmap_to_encoded(bitmap, opts);
    if (!res.success()) return nullptr;
    last_encoded = std::move(res.data);
    out_size = (int)last_encoded->size();
    return last_encoded->bytes();
}

CanvasInstance* canvas_api_create_instance(int width, int height) {
    if (width <= 0 || height <= 0) return nullptr;
    return new CanvasInstance(width, height);
}

void canvas_api_destroy_instance(CanvasInstance* inst) { delete inst; }
