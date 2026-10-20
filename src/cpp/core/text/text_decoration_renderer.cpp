#include "text_decoration_renderer.h"

#include <algorithm>
#include <cmath>

#include "core/logical_canvas.h"
#include "core/logical_geometry.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPathBuilder.h"
#include "include/effects/SkDashPathEffect.h"

namespace satoru {

namespace {

// Inline-axis interval in which the decoration line must not be painted.
struct InlineGap {
    float start;
    float end;
};

// Which side of the text baseline the `auto` mode of text-decoration-skip-ink
// skips. `all` skips every ink and `none` skips nothing, so the distinction
// only matters for `auto`.
//   BlockEnd:   the ink on the block-end side of the baseline (the underline
//               case of a horizontal writing mode).
//   BlockStart: the ink on the block-start side of the baseline (the overline
//               case of a horizontal writing mode).
// The line-through is drawn inside the text body, so it keeps the underline
// rule: only the ink that hangs below it is skipped.
enum class SkipInkSide { BlockEnd, BlockStart };

}  // namespace

void TextDecorationRenderer::drawDecoration(SkCanvas* canvas, font_info* fi,
                                            const litehtml::position& pos,
                                            const litehtml::web_color& color, double finalWidth,
                                            litehtml::writing_mode mode,
                                            const std::vector<DecorationGlyphInk>& glyph_ink) {
    float inline_size = (float)finalWidth;

    // text-decoration-thickness:
    //   from-font: the underline thickness the font itself reports.
    //   <length>:  the resolved length.
    //   auto:      1px (the user agent default).
    float thickness = (float)fi->desc.decoration_thickness.val();
    if (fi->desc.decoration_thickness.is_predefined() &&
        fi->desc.decoration_thickness.predef() ==
            litehtml::text_decoration_thickness_from_font &&
        fi->fm_underline_thickness > 0) {
        thickness = fi->fm_underline_thickness;
    }
    if (thickness == 0) thickness = 1.0f;

    litehtml::web_color dec_color = fi->desc.decoration_color;
    if (dec_color == litehtml::web_color::current_color) dec_color = color;

    SkPaint dec_paint;
    dec_paint.setColor(
        SkColorSetARGB(dec_color.alpha, dec_color.red, dec_color.green, dec_color.blue));
    dec_paint.setAntiAlias(true);
    dec_paint.setStrokeWidth(thickness);
    dec_paint.setStyle(SkPaint::kStroke_Style);

    WritingModeContext wm_ctx(mode, pos.width, pos.height);
    LogicalCanvas l_canvas(canvas, wm_ctx, (float)pos.x, (float)pos.y);

    // The parameters of the wavy decoration. The wave oscillates around
    // `block_offset + wave_amplitude`, so it is painted between `block_offset`
    // and `block_offset + 2 * wave_amplitude` and is stroked with a wider pen
    // than a solid line of the same thickness.
    const bool is_wavy = fi->desc.decoration_style == litehtml::text_decoration_style_wavy;
    const float wave_wavelength = std::max(8.0f, thickness * 8.0f);
    const float wave_amplitude = std::max(2.0f, thickness * 2.0f);
    const float wave_stroke = thickness * 1.5f;

    // Draws the decoration line between two inline-axis positions.
    auto draw_logical_line = [&](float block_offset, float x0, float x1) {
        if (x1 <= x0) return;

        logical_pos logical_start(x0, block_offset);
        logical_pos logical_end(x1, block_offset);

        if (fi->desc.decoration_style == litehtml::text_decoration_style_dotted) {
            float intervals[] = {thickness, thickness};
            dec_paint.setPathEffect(SkDashPathEffect::Make(SkSpan<const float>(intervals, 2), 0));
        } else if (fi->desc.decoration_style == litehtml::text_decoration_style_dashed) {
            float intervals[] = {thickness * 3, thickness * 3};
            dec_paint.setPathEffect(SkDashPathEffect::Make(SkSpan<const float>(intervals, 2), 0));
        }

        if (fi->desc.decoration_style == litehtml::text_decoration_style_double) {
            float gap = thickness + 1.0f;
            l_canvas.drawLine(logical_pos(x0, block_offset - gap / 2),
                              logical_pos(x1, block_offset - gap / 2), dec_paint);
            l_canvas.drawLine(logical_pos(x0, block_offset + gap / 2),
                              logical_pos(x1, block_offset + gap / 2), dec_paint);
        } else if (fi->desc.decoration_style == litehtml::text_decoration_style_wavy) {
            dec_paint.setStrokeWidth(wave_stroke);

            float block_offset_wavy = block_offset + wave_amplitude;

            bool is_vertical = wm_ctx.is_vertical();
            float phase_ref = is_vertical ? (float)pos.y : (float)pos.x;
            // The wave is aligned to a global phase so that the segments
            // produced by text-decoration-skip-ink keep a continuous wave.
            float wave_origin = -fmodf(phase_ref, wave_wavelength);
            float start_i =
                wave_origin + floorf((x0 - wave_origin) / wave_wavelength) * wave_wavelength;

            SkPathBuilder wavy_builder;
            bool first = true;

            for (float i = start_i; i < x1; i += wave_wavelength) {
                {
                    logical_pos lp1(i, block_offset_wavy);
                    logical_pos lp2(i + wave_wavelength / 4.0f, block_offset_wavy + wave_amplitude);
                    logical_pos lp3(i + wave_wavelength / 2.0f, block_offset_wavy);

                    litehtml::position p1 = wm_ctx.to_physical(lp1, logical_size(0, 0));
                    litehtml::position p2 = wm_ctx.to_physical(lp2, logical_size(0, 0));
                    litehtml::position p3 = wm_ctx.to_physical(lp3, logical_size(0, 0));

                    if (first) {
                        wavy_builder.moveTo((float)pos.x + p1.x, (float)pos.y + p1.y);
                        first = false;
                    }
                    wavy_builder.quadTo((float)pos.x + p2.x, (float)pos.y + p2.y,
                                        (float)pos.x + p3.x, (float)pos.y + p3.y);
                }
                {
                    logical_pos lp2(i + 3.0f * wave_wavelength / 4.0f,
                                    block_offset_wavy - wave_amplitude);
                    logical_pos lp3(i + wave_wavelength, block_offset_wavy);

                    litehtml::position p2 = wm_ctx.to_physical(lp2, logical_size(0, 0));
                    litehtml::position p3 = wm_ctx.to_physical(lp3, logical_size(0, 0));

                    wavy_builder.quadTo((float)pos.x + p2.x, (float)pos.y + p2.y,
                                        (float)pos.x + p3.x, (float)pos.y + p3.y);
                }
            }

            l_canvas.save();
            l_canvas.clipRect(logical_pos(x0, block_offset_wavy - wave_amplitude * 2),
                              logical_size(x1 - x0, wave_amplitude * 4));
            canvas->drawPath(wavy_builder.detach(), dec_paint);
            l_canvas.restore();
        } else {
            l_canvas.drawLine(logical_start, logical_end, dec_paint);
        }
    };

    // text-decoration-skip-ink: collect the inline-axis intervals in which the
    // decoration line would be covered by the ink of the text.
    //   auto: only the ink on one side of the baseline is skipped.
    //   all:  every glyph ink that reaches the line is skipped.
    auto collect_skip_gaps = [&](float block_offset, SkipInkSide side) {
        std::vector<InlineGap> gaps;
        if (fi->desc.decoration_skip_ink == litehtml::text_decoration_skip_ink_none) return gaps;
        if (glyph_ink.empty()) return gaps;

        // The part of the block axis the decoration covers. A wavy decoration
        // oscillates around the block offset, so it reaches further down than
        // a solid line of the same thickness and its band has to grow with
        // the amplitude of the wave.
        float band_top = block_offset - thickness * 0.5f;
        float band_bottom = block_offset + thickness * 0.5f;
        if (is_wavy) {
            band_top = block_offset - wave_stroke * 0.5f;
            band_bottom = block_offset + wave_amplitude * 2.0f + wave_stroke * 0.5f;
        }
        bool skip_all_ink = fi->desc.decoration_skip_ink == litehtml::text_decoration_skip_ink_all;

        for (const auto& g : glyph_ink) {
            float top = g.block_start;
            float bottom = g.block_end;
            if (!skip_all_ink && g.has_baseline) {
                // auto: only the ink on the selected side of the baseline counts.
                if (side == SkipInkSide::BlockEnd) {
                    top = std::max(top, g.baseline);
                } else {
                    bottom = std::min(bottom, g.baseline);
                }
            }
            if (bottom < band_top || top > band_bottom) continue;
            if (g.inline_end <= g.inline_start) continue;

            InlineGap gap{g.inline_start, g.inline_end};
            if (!gaps.empty() && gap.start <= gaps.back().end) {
                gaps.back().end = std::max(gaps.back().end, gap.end);
            } else {
                gaps.push_back(gap);
            }
        }
        return gaps;
    };

    // Draws the decoration line, skipping the intervals given by `gaps`.
    auto draw_with_gaps = [&](float block_offset, const std::vector<InlineGap>& gaps) {
        if (gaps.empty()) {
            draw_logical_line(block_offset, 0.0f, inline_size);
            return;
        }
        float cursor = 0.0f;
        for (const auto& gap : gaps) {
            if (gap.start > cursor) draw_logical_line(block_offset, cursor, gap.start);
            cursor = std::max(cursor, gap.end);
        }
        if (cursor < inline_size) draw_logical_line(block_offset, cursor, inline_size);
    };

    if (fi->desc.decoration_line & litehtml::text_decoration_line_underline) {
        float user_offset = (float)fi->desc.underline_offset.val();
        int position = fi->desc.underline_position;
        float underline_offset;

        if (wm_ctx.is_vertical()) {
            // Chromium places the vertical underline just inside the
            // block-start edge (right for vertical-rl, left for
            // vertical-lr), not at an ascent distance from it. Flush the
            // line's outer edge with the run box's block-start edge.
            if (wm_ctx.mode() == litehtml::writing_mode_vertical_rl) {
                // block-start is the right side; `left` moves the line to the
                // opposite side of the text column.
                underline_offset = (position == litehtml::text_underline_position_left)
                                       ? (float)wm_ctx.container_width() - thickness + user_offset
                                       : user_offset + thickness;
            } else {
                // vertical-lr: block-start is the left side.
                underline_offset = (position == litehtml::text_underline_position_right)
                                       ? (float)wm_ctx.container_width() - thickness + user_offset
                                       : user_offset + thickness;
            }
        } else if (position == litehtml::text_underline_position_under) {
            // Below the descenders: the bottom of the line box.
            underline_offset = (float)fi->fm_height + user_offset;
        } else if (position == litehtml::text_underline_position_from_font &&
                   fi->fm_underline_position > 0) {
            // The font reports the distance from the baseline to the top of
            // its underline stroke, so the stroke is centered half a
            // thickness below that line.
            underline_offset = (float)fi->fm_ascent_raw + fi->fm_underline_position +
                               thickness * 0.5f + user_offset;
        } else {
            // auto (left/right do not apply to horizontal writing modes).
            underline_offset = (float)fi->fm_ascent + user_offset + thickness;
        }

        // The underline hangs below the baseline in a horizontal writing mode
        // and hugs the block-start edge in a vertical one, so the side of the
        // ink that may be skipped differs.
        SkipInkSide side =
            wm_ctx.is_vertical() ? SkipInkSide::BlockStart : SkipInkSide::BlockEnd;
        draw_with_gaps(underline_offset, collect_skip_gaps(underline_offset, side));
    }
    if (fi->desc.decoration_line & litehtml::text_decoration_line_overline) {
        float overline_offset = 0;
        if (wm_ctx.is_vertical()) {
            // Mirror of underline: just inside the block-end edge.
            overline_offset = (float)wm_ctx.container_width() - thickness;
        }
        // The overline is drawn above the text, so only the ink on the
        // block-start side of the baseline can reach it.
        SkipInkSide side =
            wm_ctx.is_vertical() ? SkipInkSide::BlockEnd : SkipInkSide::BlockStart;
        draw_with_gaps(overline_offset, collect_skip_gaps(overline_offset, side));
    }
    if (fi->desc.decoration_line & litehtml::text_decoration_line_line_through) {
        float strike_offset = (float)fi->fm_ascent * 0.65f;
        draw_with_gaps(strike_offset,
                       collect_skip_gaps(strike_offset, SkipInkSide::BlockEnd));
    }
}

}  // namespace satoru
