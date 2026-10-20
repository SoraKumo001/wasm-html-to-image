#include "text_renderer.h"

// P2b: 本ファイル(約504行)の責務: 描画のみ (振る舞い不変)。
// shaping/layout は TextLayout、装飾線は TextDecorationRenderer、
// 座標は TextGeometry、Unicode判定は UnicodeService に委譲する。
// 本ファイルに shaping/layout ロジックの複製を持ち込まない。

#include <algorithm>
#include <cctype>
#include <cstring>

#include "bridge/magic_tags.h"
#include "core/logical_geometry.h"
#include "core/satoru_context.h"
#include "core/text/tagging_context.h"
#include "core/text/text_decoration_renderer.h"
#include "core/text/text_geometry.h"
#include "core/text/text_geometry.h"
#include "core/text/text_layout.h"
#include "core/text/text_types.h"
#include "core/text/unicode_service.h"
#include "include/core/SkBlurTypes.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkMaskFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkTextBlob.h"
#include "include/effects/SkDashPathEffect.h"
#include "modules/skshaper/include/SkShaper.h"
#include "utils/logging.h"

namespace satoru {

namespace {

// stroke-linejoin of a text stroke. Skia has no miter-clip / arcs joins, so they fall back
// to miter; an unspecified value keeps the historical round join.
SkPaint::Join textStrokeJoin(int linejoin) {
    switch (linejoin) {
        case litehtml::stroke_linejoin_miter:
        case litehtml::stroke_linejoin_miter_clip:
        case litehtml::stroke_linejoin_arcs:
            return SkPaint::kMiter_Join;
        case litehtml::stroke_linejoin_bevel:
            return SkPaint::kBevel_Join;
        default:
            return SkPaint::kRound_Join;
    }
}
// Vertical shift needed to align a run's baseline with the primary font's
// baseline in horizontal text. SkTextBlobBuilderRunHandler places each run's
// baseline at (origin.y + run ascent), while litehtml computes the line
// baseline from the primary font's metrics. Fallback fonts (e.g. CJK) with a
// different ascent would otherwise be vertically offset.
float baselineShiftForRun(const font_info* fi, const SkFont& run_font) {
    if (!fi || fi->fonts.empty()) return 0.0f;
    float primary_ascent = fi->fm_ascent_raw;
    if (primary_ascent <= 0.0f) {
        SkFontMetrics pm;
        fi->fonts[0]->getMetrics(&pm);
        primary_ascent = -pm.fAscent;
    }
    SkFontMetrics rm;
    run_font.getMetrics(&rm);
    return primary_ascent + rm.fAscent;
}

// Baseline shift for a blob shaped from a single font run.
float baselineShiftForBlob(const font_info* fi, const sk_sp<SkTextBlob>& blob) {
    if (!blob) return 0.0f;
    SkTextBlob::Iter it(*blob);
    SkTextBlob::Iter::ExperimentalRun run;
    if (it.experimentalNext(&run)) {
        return baselineShiftForRun(fi, run.font);
    }
    return 0.0f;
}

// Collects the ink geometry of a run's glyphs for text-decoration-skip-ink.
// `inline_origin` is the inline offset of the run inside the text box and
// `baseline_shift` the vertical shift applied to the run's baseline.
void collectGlyphInk(std::vector<DecorationGlyphInk>* out,
                     const SkTextBlob::Iter::ExperimentalRun& run, float inline_origin,
                     float baseline_shift) {
    if (!out || run.count <= 0) return;

    std::vector<SkRect> bounds;
    bounds.resize(run.count);
    run.font.getBounds(SkSpan<const SkGlyphID>(run.glyphs, run.count),
                       SkSpan<SkRect>(bounds.data(), bounds.size()), nullptr);

    for (int i = 0; i < run.count; ++i) {
        const SkRect& b = bounds[i];
        // Glyphs without ink (spaces, control characters) have empty bounds.
        if (b.isEmpty()) continue;

        DecorationGlyphInk ink;
        ink.inline_start = inline_origin + run.positions[i].fX + b.fLeft;
        ink.inline_end = inline_origin + run.positions[i].fX + b.fRight;
        // The baseline and the ink of the run are measured from the top of the
        // text box, like the block offsets of the decoration.
        ink.baseline = run.positions[i].fY + baseline_shift;
        ink.block_start = ink.baseline + b.fTop;
        ink.block_end = ink.baseline + b.fBottom;
        out->push_back(ink);
    }
}

// Collects the ink of a single glyph of a vertical writing mode.
// `bounds` is the box of the glyph in the horizontal text frame (relative to
// the glyph origin on the baseline), `p` the physical position of the glyph
// origin and `rotated` whether the glyph is turned by 90 degrees.
// The ink is rotated into the logical frame with it: the inline axis of a
// vertical writing mode runs downwards and the block axis runs from the
// block-start edge (the right edge in vertical-rl) towards the block-end one.
void collectVerticalGlyphInk(std::vector<DecorationGlyphInk>* out, const SkRect& bounds,
                             const GlyphPlacement& p, bool rotated,
                             const litehtml::position& pos, litehtml::writing_mode mode) {
    if (!out || bounds.isEmpty()) return;

    // The physical box of the ink. A turned glyph is rotated by 90 degrees
    // clockwise, so its local x axis points downwards and its local y axis
    // points to the left.
    float px0, px1, py0, py1;
    if (rotated) {
        px0 = p.x - bounds.fBottom;
        px1 = p.x - bounds.fTop;
        py0 = p.y + bounds.fLeft;
        py1 = p.y + bounds.fRight;
    } else {
        px0 = p.x + bounds.fLeft;
        px1 = p.x + bounds.fRight;
        py0 = p.y + bounds.fTop;
        py1 = p.y + bounds.fBottom;
    }

    DecorationGlyphInk ink;
    ink.inline_start = py0 - (float)pos.y;
    ink.inline_end = py1 - (float)pos.y;
    if (mode == litehtml::writing_mode_vertical_rl) {
        // The block-start edge is the right edge of the text box.
        const float block_start_edge = (float)(pos.x + pos.width);
        ink.block_start = block_start_edge - px1;
        ink.block_end = block_start_edge - px0;
        ink.baseline = block_start_edge - p.x;
    } else {
        // vertical-lr: the block-start edge is the left edge of the text box.
        ink.block_start = px0 - (float)pos.x;
        ink.block_end = px1 - (float)pos.x;
        ink.baseline = p.x - (float)pos.x;
    }
    // An upright glyph is not turned, so it has no descender side to pick:
    // the whole ink counts.
    ink.has_baseline = rotated;
    out->push_back(ink);
}

// The ink boxes of a run's glyphs, relative to the glyph origins on the
// baseline. The boxes of the glyphs without ink (spaces, control characters)
// are empty.
std::vector<SkRect> glyphInkBounds(const SkTextBlob::Iter::ExperimentalRun& run) {
    std::vector<SkRect> bounds;
    bounds.resize(run.count);
    run.font.getBounds(SkSpan<const SkGlyphID>(run.glyphs, run.count),
                       SkSpan<SkRect>(bounds.data(), bounds.size()), nullptr);
    return bounds;
}

// text-emphasis (圏点): litehtml の css_properties が emphasis_style/color/position を
// 解析して font_description に格納するが、描画は未対応だったためここで打つ。
// filled/open × dot/circle/double-circle(円近似)/triangle/sesame と、
// カスタム文字列 (text-emphasis-style: <string>、実質 1 文字) に対応する。
// カスタム文字列は per-glyph の文字描画として載せる (最初の非空白文字のみ使用。
// spec 上 2 文字目は空白のみ許可され、描画には寄与しない)。
struct EmphasisSpec {
    bool enabled = false;
    bool filled = true;
    enum Shape { Dot, Triangle, Sesame } shape = Dot;
    char32_t custom = 0;  // != 0: 図形ではなくこの文字を打つ
};

bool isEmphasisSpace(char32_t u) {
    // Chromium は空白に圏点を打たない (U+0020 / NBSP / 全角空白 / ASCII制御空白)
    return u == 0x20 || u == 0x00A0 || u == 0x3000 || (u >= 0x09 && u <= 0x0D);
}

// UTF-8 1 文字を読む (text-emphasis のカスタム文字列用の最小デコーダ)。
char32_t decodeEmphasisUtf8(const char*& p) {
    const unsigned char* s = (const unsigned char*)p;
    char32_t ch;
    int extra;
    if (s[0] < 0x80) {
        ch = s[0];
        extra = 0;
    } else if ((s[0] & 0xE0) == 0xC0) {
        ch = s[0] & 0x1F;
        extra = 1;
    } else if ((s[0] & 0xF0) == 0xE0) {
        ch = s[0] & 0x0F;
        extra = 2;
    } else if ((s[0] & 0xF8) == 0xF0) {
        ch = s[0] & 0x07;
        extra = 3;
    } else {
        p++;
        return 0xFFFD;
    }
    p++;
    for (int i = 0; i < extra; ++i) {
        if (*p == 0 || ((unsigned char)*p & 0xC0) != 0x80) return 0xFFFD;
        ch = (ch << 6) | ((unsigned char)*p++ & 0x3F);
    }
    return ch;
}

// カスタム文字列の最初の非空白文字を返す (無ければ 0)。
char32_t firstEmphasisChar(const char* begin, const char* end) {
    const char* p = begin;
    while (p < end && *p) {
        char32_t ch = decodeEmphasisUtf8(p);
        if (!isEmphasisSpace(ch) && ch != 0) return ch;
    }
    return 0;
}

EmphasisSpec parseEmphasisStyle(const std::string& style) {
    EmphasisSpec spec;
    if (style.empty()) return spec;
    // ショートハンドはトークン値そのまま (引用符なし)、ロングハンドは宣言の repr
    // (引用符付き) が来るため、どちらも同じ規則で走査する。
    bool has_none = false;
    size_t i = 0;
    while (i < style.size()) {
        while (i < style.size() && std::isspace((unsigned char)style[i])) i++;
        if (i >= style.size()) break;
        const size_t start = i;
        // 引用符付き文字列は中の空白ごと 1 トークンとして扱う
        if (style[i] == '\'' || style[i] == '"') {
            const char quote = style[i++];
            const size_t inner = i;
            while (i < style.size() && style[i] != quote) i++;
            char32_t ch = firstEmphasisChar(style.c_str() + inner, style.c_str() + i);
            if (ch != 0) spec.custom = ch;
            if (i < style.size()) i++;
            continue;
        }
        while (i < style.size() && !std::isspace((unsigned char)style[i])) i++;
        std::string token = style.substr(start, i - start);
        std::string lower;
        lower.reserve(token.size());
        for (unsigned char c : token) lower.push_back((char)std::tolower(c));
        if (lower == "none") {
            has_none = true;
        } else if (lower == "open") {
            spec.filled = false;
        } else if (lower == "filled") {
            spec.filled = true;
        } else if (lower == "sesame") {
            spec.shape = EmphasisSpec::Sesame;
        } else if (lower == "triangle") {
            spec.shape = EmphasisSpec::Triangle;
        } else if (lower == "dot" || lower == "circle" || lower == "double-circle") {
            spec.shape = EmphasisSpec::Dot;  // double-circle は円近似
        } else {
            // カスタム文字列 (ショートハンドでは引用符が落ちる)
            char32_t ch = firstEmphasisChar(token.c_str(), token.c_str() + token.size());
            if (ch != 0) spec.custom = ch;
        }
    }
    if (has_none && spec.custom == 0) return spec;
    spec.enabled = true;
    return spec;
}

// 1つの圏点を (cx, cy) 中心に打つ。(ox, oy): 外向き法線、(ix, iy): インライン方向。
void drawEmphasisMark(SkCanvas* canvas, const EmphasisSpec& spec, float cx, float cy, float size,
                      const SkPaint& base, float ox, float oy, float ix, float iy) {
    SkPaint paint(base);
    paint.setPathEffect(nullptr);
    if (spec.shape == EmphasisSpec::Sesame) {
        // ゴマ点: 短い太線 (縦書き "＼" / 横書き "、")。軸 = inline - outward。
        paint.setStyle(SkPaint::kStroke_Style);
        paint.setStrokeWidth(std::max(1.0f, size * 0.12f));
        paint.setStrokeCap(SkPaint::kRound_Cap);
        float k = size * 0.11f;
        float ax = ix - ox, ay = iy - oy;
        canvas->drawLine(cx + ax * k, cy + ay * k, cx - ax * k, cy - ay * k, paint);
        return;
    }
    float r = size * 0.11f;
    if (spec.shape == EmphasisSpec::Triangle) {
        // 頂点を外側に向けた三角形
        float px = -oy, py = ox;
        SkPathBuilder builder;
        builder.moveTo(cx + ox * r, cy + oy * r);
        builder.lineTo(cx - ox * r * 0.8f + px * r * 0.9f, cy - oy * r * 0.8f + py * r * 0.9f);
        builder.lineTo(cx - ox * r * 0.8f - px * r * 0.9f, cy - oy * r * 0.8f - py * r * 0.9f);
        builder.close();
        SkPath path = builder.detach();
        if (spec.filled) {
            paint.setStyle(SkPaint::kFill_Style);
        } else {
            paint.setStyle(SkPaint::kStroke_Style);
            paint.setStrokeWidth(std::max(1.0f, size * 0.07f));
            paint.setStrokeJoin(SkPaint::kRound_Join);
        }
        canvas->drawPath(path, paint);
        return;
    }
    // Dot / circle (double-circle は円近似)
    if (spec.filled) {
        paint.setStyle(SkPaint::kFill_Style);
        canvas->drawCircle(cx, cy, r, paint);
    } else {
        paint.setStyle(SkPaint::kStroke_Style);
        paint.setStrokeWidth(std::max(1.0f, size * 0.07f));
        canvas->drawCircle(cx, cy, r, paint);
    }
}

// 圏点用の書体を選ぶ: 本文のラン書体 → 同じ font_info の書体 → 読み込み済みの
// フォールバック書体 → per-glyph 選択、の順にグリフを持つものを探す。
// (● のようにラン書体に無い記号は、同じ family の別フェイスにあることが多い)
SkFont emphasisFont(SatoruContext* ctx, font_info* fi, const SkFont& run_font, char32_t ch) {
    const SkUnichar u = (SkUnichar)ch;
    if (run_font.unicharToGlyph(u) != 0) return run_font;
    for (auto& f : fi->fonts) {
        if (f && f->getTypeface() && f->getTypeface()->unicharToGlyph(u) != 0) {
            SkFont font = run_font;
            font.setTypeface(sk_ref_sp(f->getTypeface()));
            return font;
        }
    }
    if (sk_sp<SkTypeface> tf = ctx->fontManager.findTypefaceForCodepoint(u)) {
        SkFont font = run_font;
        font.setTypeface(tf);
        return font;
    }
    return ctx->fontManager.selectFont(ch, fi, nullptr, ctx->getUnicodeService());
}

// カスタム文字列の圏点を 1 つ打つ。グリフのインク中心を (cx, cy) に合わせる。
// 縦書きでも記号自体は正立で描く (Chromium の圏点は書字方向に関わらず正立)。
void drawEmphasisGlyph(SkCanvas* canvas, SatoruContext* ctx, font_info* fi, const SkFont& run_font,
                       char32_t ch, float cx, float cy, const SkPaint& base) {
    SkFont font = emphasisFont(ctx, fi, run_font, ch);
    // 圏点は本文サイズの半分で打つ (Chromium の emphasis mark と同じ)。
    font.setSize(run_font.getSize() * 0.5f);
    const SkGlyphID gid = font.unicharToGlyph((SkUnichar)ch);
    if (!gid) return;
    const SkRect bounds = font.getBounds(gid, nullptr);
    if (bounds.isEmpty()) return;
    SkTextBlobBuilder builder;
    auto run = builder.allocRunPos(font, 1);
    run.glyphs[0] = gid;
    run.pos[0] = cx - (bounds.left() + bounds.right()) * 0.5f;
    run.pos[1] = cy - (bounds.top() + bounds.bottom()) * 0.5f;
    SkPaint paint(base);
    paint.setPathEffect(nullptr);
    paint.setStyle(SkPaint::kFill_Style);
    sk_sp<SkTextBlob> blob = builder.make();
    if (blob) canvas->drawTextBlob(blob.get(), 0, 0, paint);
}

// 1ランの圏点を打つ。グリフ位置は本文と同じ shaping 結果から求める。
void drawEmphasisRun(SkCanvas* canvas, SatoruContext* ctx, font_info* fi,
                     const litehtml::position& pos, litehtml::writing_mode mode,
                     const SkPaint& paint, const EmphasisSpec& spec, const TextAnalysis& run_chars,
                     const ShapedResult& shaped, float inline_start, bool is_upright,
                     bool is_punctuation, bool is_rtl) {
    struct GlyphPos {
        float x;
        float y;
        SkFont font;
        SkGlyphID id;
    };
    std::vector<GlyphPos> glyphs;
    SkTextBlob::Iter it(*shaped.blob);
    SkTextBlob::Iter::ExperimentalRun run;
    while (it.experimentalNext(&run)) {
        for (int i = 0; i < run.count; ++i) {
            glyphs.push_back({run.positions[i].fX, run.positions[i].fY, run.font, run.glyphs[i]});
        }
    }
    if (glyphs.empty()) return;
    // LTR かつグリフ数=文字数の場合のみ 1:1 対応で空白・結合マークを除外する。
    // (RTL や合字は全グリフに打つフォールバック)
    bool one_to_one = !is_rtl && run_chars.chars.size() == glyphs.size();

    bool is_vertical =
        (mode == litehtml::writing_mode_vertical_rl || mode == litehtml::writing_mode_vertical_lr);
    int epos = fi->desc.emphasis_position;
    bool second_side;
    if (!is_vertical) {
        second_side = (epos & litehtml::text_emphasis_position_under) != 0;
    } else {
        // 縦書き: over/right=右側、under/left=左側 (既定 over right=右側)
        second_side =
            ((epos &
              (litehtml::text_emphasis_position_under | litehtml::text_emphasis_position_left)) !=
             0) &&
            ((epos & litehtml::text_emphasis_position_right) == 0);
    }
    float ox = 0.0f, oy = 0.0f, ix = 1.0f, iy = 0.0f;
    if (!is_vertical) {
        ix = 1.0f;
        iy = 0.0f;
        oy = second_side ? 1.0f : -1.0f;
    } else {
        ix = 0.0f;
        iy = 1.0f;
        ox = second_side ? -1.0f : 1.0f;
    }

    float size = (float)fi->desc.size;
    if (!(size > 0.0f)) return;
    float gap = size * 0.19f;  // グリフ端からマーク中心まで

    SkPaint mark_paint(paint);
    if (!fi->desc.emphasis_color.is_current_color) {
        const auto& e = fi->desc.emphasis_color;
        mark_paint.setColor(
            SkColorSetARGB(SkColorGetA(paint.getColor()), e.red, e.green, e.blue));
    }

    TextGeometry geom(mode, pos, fi);
    size_t n = glyphs.size();
    for (size_t i = 0; i < n; ++i) {
        if (one_to_one) {
            const auto& ch = run_chars.chars[i];
            if (ch.is_mark || isEmphasisSpace(ch.codepoint)) continue;
        }
        float adv = (i + 1 < n) ? (glyphs[i + 1].x - glyphs[i].x)
                                : (float)(shaped.width - glyphs[i].x);
        float cx, cy;
        if (is_vertical) {
            float gx = inline_start + glyphs[i].x;
            auto p = geom.getGlyphPlacement(gx, glyphs[i].y, is_upright, is_punctuation,
                                            glyphs[i].font, glyphs[i].id);
            SkFontMetrics m;
            glyphs[i].font.getMetrics(&m);
            float left, right;
            if (is_upright) {
                float w = glyphs[i].font.getWidth(glyphs[i].id);
                left = p.x;
                right = p.x + w;
            } else {
                // 90度回転 (RSXform) の描画と同値: X 範囲は [px-descent, px+ascent]
                left = p.x - m.fDescent;
                right = p.x - m.fAscent;
            }
            cx = (ox > 0.0f) ? (right + gap) : (left - gap);
            cy = (float)pos.y + gx + adv * 0.5f;
        } else {
            float base =
                (float)pos.y + glyphs[i].y + baselineShiftForRun(fi, glyphs[i].font);
            cx = (float)pos.x + inline_start + glyphs[i].x + adv * 0.5f;
            SkFontMetrics m;
            glyphs[i].font.getMetrics(&m);
            cy = (oy < 0.0f) ? (base + m.fAscent - gap) : (base + m.fDescent + gap);
        }
        if (spec.custom != 0) {
            drawEmphasisGlyph(canvas, ctx, fi, glyphs[i].font, spec.custom, cx, cy, mark_paint);
        } else {
            drawEmphasisMark(canvas, spec, cx, cy, size, mark_paint, ox, oy, ix, iy);
        }
    }
}
}  // namespace

char32_t TextRenderer::emphasisCodepoint(const font_info* fi) {
    if (!fi) return 0;
    return parseEmphasisStyle(fi->desc.emphasis_style).custom;
}

void TextBatcher::addText(const sk_sp<SkTextBlob>& blob, double tx, double ty, const Style& style) {
    if (m_active && m_currentStyle != style) {
        flush();
    }

    bool is_vertical = (style.mode == litehtml::writing_mode_vertical_rl ||
                        style.mode == litehtml::writing_mode_vertical_lr);

    if (!m_active) {
        m_currentStyle = style;
        if (is_vertical) {
            // For vertical writing, we always need to rebuild the blob to apply
            // coordinate swapping and centering/rotation logic.
            addBlobToBuilder(blob, tx, ty);
        } else {
            m_firstBlob = blob;
            m_firstTx = tx;
            m_firstTy = ty;
            m_firstTyShift = baselineShiftForBlob(style.fi, blob);
        }
        m_active = true;
        return;
    }

    if (m_firstBlob) {
        addBlobToBuilder(m_firstBlob, m_firstTx, m_firstTy);
        m_firstBlob = nullptr;
    }
    addBlobToBuilder(blob, tx, ty);
}

void TextBatcher::addBlobToBuilder(const sk_sp<SkTextBlob>& blob, double tx, double ty) {
    // Baseline normalization for horizontal text (see baselineShiftForRun):
    // align each run's baseline with the primary font's baseline.
    bool is_vertical = (m_currentStyle.mode == litehtml::writing_mode_vertical_rl ||
                        m_currentStyle.mode == litehtml::writing_mode_vertical_lr);

    SkTextBlob::Iter it(*blob);
    SkTextBlob::Iter::ExperimentalRun run;
    while (it.experimentalNext(&run)) {
        litehtml::position line_pos((pixel_t)tx, (pixel_t)ty, (pixel_t)m_currentStyle.line_width,
                                    0);
        TextGeometry geom(m_currentStyle.mode, line_pos, m_currentStyle.fi);

        if (geom.isVertical() && !m_currentStyle.is_vertical_upright) {
            auto builder_run = m_builder.allocRunRSXform(run.font, run.count);
            memcpy(builder_run.glyphs, run.glyphs, run.count * sizeof(uint16_t));
            for (int i = 0; i < run.count; ++i) {
                auto p = geom.getGlyphPlacement(run.positions[i].fX, run.positions[i].fY, false,
                                                false, run.font, run.glyphs[i]);
                // Rotate 90 deg CW: cos=0, sin=1
                builder_run.xforms()[i] = SkRSXform::Make(0, 1, p.x, p.y);
            }
        } else {
            float run_baseline_shift =
                is_vertical ? 0.0f : baselineShiftForRun(m_currentStyle.fi, run.font);
            auto builder_run = m_builder.allocRunPos(run.font, run.count);
            memcpy(builder_run.glyphs, run.glyphs, run.count * sizeof(uint16_t));
            for (int i = 0; i < run.count; ++i) {
                auto p = geom.getGlyphPlacement(
                    run.positions[i].fX, run.positions[i].fY, m_currentStyle.is_vertical_upright,
                    m_currentStyle.is_vertical_punctuation, run.font, run.glyphs[i]);
                builder_run.pos[i * 2] = p.x;
                builder_run.pos[i * 2 + 1] = p.y + run_baseline_shift;
            }
        }
    }
}

void TextBatcher::flush() {
    if (!m_active) return;

    SkPaint paint;
    paint.setAntiAlias(true);
    if (m_currentStyle.is_emoji) {
        paint.setColor(0xFFFFFFFF);  // Use white (opaque) for color emojis

        // Ensure the paint is correctly set for color bitmaps
        // paint.setFilterQuality is deprecated in newer Skia, use SkSamplingOptions
        paint.setBlendMode(SkBlendMode::kSrcOver);
    } else {
        paint.setColor(SkColorSetARGB(m_currentStyle.color.alpha, m_currentStyle.color.red,
                                      m_currentStyle.color.green, m_currentStyle.color.blue));
    }

    if (m_currentStyle.opacity < 1.0f) {
        paint.setAlphaf(paint.getAlphaf() * m_currentStyle.opacity);
    }

    if (m_firstBlob) {
        m_canvas->drawTextBlob(m_firstBlob, (float)m_firstTx,
                               (float)(m_firstTy + m_firstTyShift), paint);
        m_firstBlob = nullptr;
    } else {
        sk_sp<SkTextBlob> blob = m_builder.make();
        if (blob) {
            m_canvas->drawTextBlob(blob, 0, 0, paint);
        }
    }
    m_active = false;

    // Reset current style
    m_currentStyle = {nullptr,
                      {0, 0, 0, 0},
                      0.0f,
                      false,
                      litehtml::writing_mode_horizontal_tb,
                      0.0f,
                      true,
                      false,
                      litehtml::text_combine_upright_none,
                      false};
}

void TextRenderer::drawText(SatoruContext* ctx, SkCanvas* canvas, const char* text, font_info* fi,
                            const litehtml::web_color& color, const litehtml::position& pos,
                            litehtml::text_overflow overflow, litehtml::direction dir,
                            litehtml::writing_mode mode, bool tagging, float currentOpacity,
                            std::vector<text_shadow_info>& usedTextShadows,
                            std::vector<text_draw_info>& usedTextDraws,
                            std::vector<SkPath>& usedGlyphs,
                            std::vector<glyph_draw_info>& usedGlyphDraws,
                            std::set<char32_t>* usedCodepoints, TextBatcher* batcher,
                            bool forceEllipsis) {
    if (!canvas || !fi || fi->fonts.empty()) return;

    fi->is_rtl = (dir == litehtml::direction_rtl);

    litehtml::position actual_pos = pos;
    const char* draw_text = text;
    size_t draw_text_len = std::strlen(text);
    std::string ellipsized_text;
    if (overflow == litehtml::text_overflow_ellipsis) {
        double available_size =
            (mode == litehtml::writing_mode_horizontal_tb) ? pos.width : pos.height;
        // litehtml marks a forced ellipsis by collapsing the run to ~0 width.
        // In that case the caller (container_skia) has already recovered the real
        // available width from the clip box, so use it as the ellipsize budget.
        bool forced = forceEllipsis || (available_size < 1.0f);
        double margin = 2.0;
        double budget = available_size;
        if (forced && mode != litehtml::writing_mode_horizontal_tb) {
            budget = pos.height;
        }
        if (budget < 1.0f) {
            // No usable width at all: leave the text untouched rather than drawing
            // a bare ellipsis (the previous behavior).
            budget = 0.0;
        }

        if (budget > 0.0 &&
            (forced || TextLayout::measureText(ctx, text, fi, mode, -1.0, nullptr).width >
                           available_size + margin)) {
            ellipsized_text = TextLayout::ellipsizeText(ctx, text, fi, mode, budget,
                                                        usedCodepoints, forced);
            draw_text = ellipsized_text.c_str();
            draw_text_len = ellipsized_text.size();
        }
    }

    SkPaint paint;
    paint.setAntiAlias(true);

    // -webkit-text-stroke. WebKit paints the fill first and the centered stroke
    // on top, so the stroke's inner half overlaps (and hides) the glyph body for
    // an opaque stroke. stroke_color defaults to currentColor, which may resolve
    // to the same color as the fill or to the element's `color`.
    const bool has_stroke = fi->desc.text_stroke_width > 0.0f;
    const float stroke_width = has_stroke ? fi->desc.text_stroke_width : 0.0f;
    litehtml::web_color stroke_color = fi->desc.text_stroke_color;
    // NOTE: web_color::operator== ignores is_current_color, so test the flag directly.
    if (stroke_color.is_current_color) stroke_color = color;

    int styleIndex = -1;
    MagicTag styleTag = MagicTag::TextDraw;

    if (tagging && !fi->desc.text_shadow.empty()) {
        text_shadow_info info;
        info.shadows = fi->desc.text_shadow;
        info.text_color = color;
        info.opacity = currentOpacity;
        info.has_stroke = has_stroke;
        info.stroke_width = stroke_width;
        info.stroke_color = stroke_color;
        info.stroke_linejoin = fi->desc.stroke_linejoin;

        styleTag = MagicTag::TextShadow;
        for (size_t i = 0; i < usedTextShadows.size(); ++i) {
            if (usedTextShadows[i] == info) {
                styleIndex = (int)i + 1;
                break;
            }
        }

        if (styleIndex == -1) {
            usedTextShadows.push_back(info);
            styleIndex = (int)usedTextShadows.size();
        }

        paint.setColor(make_magic_color(MagicTag::TextShadow, styleIndex));
    } else if (tagging) {
        text_draw_info info;
        info.weight = fi->desc.weight;
        info.italic = (fi->desc.style == litehtml::font_style_italic);
        info.color = color;
        info.opacity = currentOpacity;
        info.has_stroke = has_stroke;
        info.stroke_width = stroke_width;
        info.stroke_color = stroke_color;
        info.stroke_linejoin = fi->desc.stroke_linejoin;

        styleTag = MagicTag::TextDraw;
        usedTextDraws.push_back(info);
        styleIndex = (int)usedTextDraws.size();

        paint.setColor(make_magic_color(MagicTag::TextDraw, styleIndex));
    } else {
        paint.setColor(SkColorSetARGB(color.alpha, color.red, color.green, color.blue));
    }

    if (!tagging && !fi->desc.text_shadow.empty()) {
        for (auto it = fi->desc.text_shadow.rbegin(); it != fi->desc.text_shadow.rend(); ++it) {
            const auto& s = *it;
            SkPaint shadow_paint = paint;
            shadow_paint.setColor(
                SkColorSetARGB(s.color.alpha, s.color.red, s.color.green, s.color.blue));
            float blur_std_dev = (float)s.blur.val() * 0.5f;
            if (blur_std_dev > 0)
                shadow_paint.setMaskFilter(
                    SkMaskFilter::MakeBlur(kNormal_SkBlurStyle, blur_std_dev));

            if (has_stroke) {
                // A single stroke+fill draw gives one coverage for the blur, so
                // the stroke/fill overlap does not darken a translucent shadow.
                shadow_paint.setStyle(SkPaint::kStrokeAndFill_Style);
                shadow_paint.setStrokeWidth(stroke_width);
                shadow_paint.setStrokeJoin(textStrokeJoin(fi->desc.stroke_linejoin));
                shadow_paint.setStrokeMiter(4.0f);
                shadow_paint.setStrokeCap(SkPaint::kRound_Cap);
            }

            drawTextInternal(ctx, canvas, draw_text, draw_text_len, fi, actual_pos, mode,
                             shadow_paint, false, usedTextDraws, usedGlyphs, usedGlyphDraws,
                             usedCodepoints, batcher);
        }
    }

    // Unstroked text may still be buffered by the batcher; flush it before the
    // stroked run so the stroke/fill are composited in the correct order.
    if (has_stroke && !tagging && batcher) batcher->flush();

    // text-decoration-skip-ink needs the ink geometry of the drawn glyphs.
    // The underline, the overline and the line-through are all affected, in
    // the horizontal as well as in the vertical writing modes.
    const bool want_glyph_ink =
        fi->desc.decoration_line != litehtml::text_decoration_line_none &&
        fi->desc.decoration_skip_ink != litehtml::text_decoration_skip_ink_none;
    std::vector<DecorationGlyphInk> glyph_ink;

    double final_width = drawTextInternal(
        ctx, canvas, draw_text, draw_text_len, fi, actual_pos, mode, paint, tagging, usedTextDraws,
        usedGlyphs, usedGlyphDraws, usedCodepoints, batcher, (int)styleTag, styleIndex,
        want_glyph_ink ? &glyph_ink : nullptr);

    if (has_stroke && !tagging) {
        // WebKit paints the centered stroke ON TOP of the fill, so its inner half
        // overlaps the glyph body (an opaque stroke visually hides the fill).
        SkPaint stroke_paint = paint;
        stroke_paint.setColor(
            SkColorSetARGB(stroke_color.alpha, stroke_color.red, stroke_color.green, stroke_color.blue));
        stroke_paint.setStyle(SkPaint::kStroke_Style);
        stroke_paint.setStrokeWidth(stroke_width);
        stroke_paint.setStrokeJoin(textStrokeJoin(fi->desc.stroke_linejoin));
        stroke_paint.setStrokeMiter(4.0f);
        stroke_paint.setStrokeCap(SkPaint::kRound_Cap);
        drawTextInternal(ctx, canvas, draw_text, draw_text_len, fi, actual_pos, mode, stroke_paint,
                         false, usedTextDraws, usedGlyphs, usedGlyphDraws, usedCodepoints, nullptr,
                         (int)styleTag, styleIndex);
    }

    if (fi->desc.decoration_line != litehtml::text_decoration_line_none) {
        TextDecorationRenderer::drawDecoration(canvas, fi, pos, color, final_width, mode, glyph_ink);
    }
}

double TextRenderer::drawTextInternal(SatoruContext* ctx, SkCanvas* canvas, const char* str,
                                      size_t strLen, font_info* fi, const litehtml::position& pos,
                                      litehtml::writing_mode mode, const SkPaint& paint,
                                      bool tagging, std::vector<text_draw_info>& usedTextDraws,
                                      std::vector<SkPath>& usedGlyphs,
                                      std::vector<glyph_draw_info>& usedGlyphDraws,
                                      std::set<char32_t>* usedCodepoints, TextBatcher* batcher,
                                      int styleTag, int styleIndex,
                                      std::vector<DecorationGlyphInk>* glyphInk) {
    if (strLen == 0) return 0.0;

    TextAnalysis analysis =
        TextLayout::analyzeText(ctx, str, strLen, fi, mode, usedCodepoints, false);
    double total_advance = 0;

    // 論理的なインラインオフセットで行頭からの位置を追跡
    logical_pos current_l_pos(0, 0);

    bool is_vertical =
        (mode == litehtml::writing_mode_vertical_rl || mode == litehtml::writing_mode_vertical_lr);

    // text-emphasis (圏点): バッチャ経路では直接描画と順序がずれるため、圏点ありは直接描画にする。
    EmphasisSpec emphasis_spec = parseEmphasisStyle(fi->desc.emphasis_style);
    bool want_emphasis =
        emphasis_spec.enabled && !tagging && paint.getStyle() != SkPaint::kStroke_Style;
    // カスタム文字列の圏点は本文とは別のコードポイントを打つ。書体のサブセット取得が
    // その文字を覆うよう、使用文字として登録する (● 等は別ブロックのことがある)。
    if (emphasis_spec.custom != 0 && usedCodepoints) usedCodepoints->insert(emphasis_spec.custom);

    size_t start = 0;
    while (start < analysis.chars.size()) {
        size_t end = start + 1;
        while (
            end < analysis.chars.size() && analysis.chars[end].font == analysis.chars[start].font &&
            analysis.chars[end].is_vertical_upright == analysis.chars[start].is_vertical_upright &&
            analysis.chars[end].is_vertical_punctuation ==
                analysis.chars[start].is_vertical_punctuation) {
            // If text-combine-upright: all is used, we only want to combine characters
            // that are part of the same text-combine run.
            // In litehtml, a <span> with a property usually creates a separate element,
            // and thus a separate draw_text call.
            // However, analyzeText might have analyzed across multiple elements if not handled
            // carefully. For now, let's assume one draw_text call corresponds to one text-combine
            // group if it's set on the element.

            end++;
        }

        size_t run_offset = analysis.chars[start].offset;
        size_t run_len = analysis.chars[end - 1].offset + analysis.chars[end - 1].len - run_offset;
        bool is_upright = analysis.chars[start].is_vertical_upright;
        bool is_punctuation = analysis.chars[start].is_vertical_punctuation;

        TextAnalysis run_analysis;
        run_analysis.bidi_level = analysis.bidi_level;
        run_analysis.chars.reserve(end - start);
        for (size_t i = start; i < end; ++i) {
            TextCharAnalysis ca = analysis.chars[i];
            ca.offset -= run_offset;
            run_analysis.chars.push_back(ca);
        }
        const char* run_text = analysis.substituted_text.c_str() + run_offset;
        ShapedResult shaped = TextLayout::shapePreparedText(ctx, run_text, run_len, run_text,
                                                            run_len, fi, mode, run_analysis);
        if (!shaped.blob) {
            start = end;
            continue;
        }

        // A text-combine-upright run is drawn horizontally and squeezed into one em, so it needs
        // the natural advances, not the one-em-per-glyph spacing of upright vertical text.
        float natural_dy = 0.0f;  // horizontal shaping puts the baseline one ascent below the origin
        if (is_vertical && is_upright &&
            fi->desc.text_combine_upright_ == litehtml::text_combine_upright_all) {
            TextAnalysis horizontal = TextLayout::analyzeText(
                ctx, run_text, run_len, fi, litehtml::writing_mode_horizontal_tb, nullptr, false);
            ShapedResult natural = TextLayout::shapePreparedText(
                ctx, run_text, run_len, horizontal.substituted_text.c_str(),
                horizontal.substituted_text.size(), fi, litehtml::writing_mode_horizontal_tb,
                horizontal);
            if (natural.blob) {
                shaped = natural;
                SkFontMetrics nm;
                analysis.chars[start].font.getMetrics(&nm);
                natural_dy = nm.fAscent;
            }
        }

        bool is_run_combine =
            (is_vertical && is_upright &&
             fi->desc.text_combine_upright_ == litehtml::text_combine_upright_all);

        if (tagging) {
            if (batcher) batcher->flush();
            SkTextBlob::Iter it(*shaped.blob);
            SkTextBlob::Iter::ExperimentalRun run;
            TaggingContext tagging_ctx(canvas, usedGlyphs, usedGlyphDraws, styleTag, styleIndex);

            canvas->save();
            if (is_run_combine) {
                float scale = 1.0f;
                if (shaped.width > fi->desc.size && fi->desc.size > 0) {
                    scale = (float)fi->desc.size / (float)shaped.width;
                }
                float centerX = (float)pos.x + (float)pos.width / 2.0f;
                float runY = (float)pos.y + (float)current_l_pos.inline_offset;
                canvas->translate(centerX, runY);
                canvas->scale(scale, 1.0f);

                while (it.experimentalNext(&run)) {
                    SkFontMetrics metrics;
                    run.font.getMetrics(&metrics);
                    // Center the run vertically in its font_size-tall slot.
                    float font_size = (float)fi->desc.size;
                    float run_baselineY =
                        font_size / 2.0f - (metrics.fAscent + metrics.fDescent) / 2.0f;
                    for (int i = 0; i < run.count; ++i) {
                        float px = -(float)shaped.width / 2.0f + run.positions[i].fX;
                        float py = run_baselineY + natural_dy + run.positions[i].fY;
                        tagging_ctx.drawGlyph(run.font, run.glyphs[i], px, py, 0, paint);
                    }
                }
            } else {
                TextGeometry geom(mode, pos, fi);
                while (it.experimentalNext(&run)) {
                    float run_baseline_shift =
                        is_vertical ? 0.0f : baselineShiftForRun(fi, run.font);
                    float logical_run_start = (float)current_l_pos.inline_offset;
                    // The glyphs are painted as paths here, so the ink has to be
                    // collected explicitly for text-decoration-skip-ink. In a
                    // vertical writing mode the ink is rotated into the logical
                    // frame with the glyphs, so it is collected per glyph.
                    std::vector<SkRect> ink_bounds;
                    if (glyphInk) {
                        if (is_vertical) {
                            ink_bounds = glyphInkBounds(run);
                        } else {
                            collectGlyphInk(glyphInk, run, logical_run_start, run_baseline_shift);
                        }
                    }
                    for (int i = 0; i < run.count; ++i) {
                        auto p = geom.getGlyphPlacement(logical_run_start + run.positions[i].fX,
                                                        run.positions[i].fY, is_upright,
                                                        is_punctuation, run.font, run.glyphs[i]);
                        if (glyphInk && is_vertical) {
                            collectVerticalGlyphInk(glyphInk, ink_bounds[i], p,
                                                    p.rotation != 0.0f, pos, mode);
                        }
                        tagging_ctx.drawGlyph(run.font, run.glyphs[i], p.x,
                                              p.y + run_baseline_shift, p.rotation, paint);
                    }
                }
            }
            canvas->restore();
        } else if (batcher && fi->desc.text_shadow.empty() &&
                   fi->desc.decoration_line == litehtml::text_decoration_line_none &&
                   fi->desc.text_stroke_width <= 0.0f && !is_run_combine && !want_emphasis) {
            TextBatcher::Style style;
            style.fi = fi;
            SkColor c = paint.getColor();
            style.color = {(uint8_t)SkColorGetR(c), (uint8_t)SkColorGetG(c),
                           (uint8_t)SkColorGetB(c), (uint8_t)SkColorGetA(c)};
            style.opacity = 1.0f;
            style.tagging = false;
            style.mode = mode;
            style.line_width = is_vertical ? (float)pos.width : (float)pos.height;
            style.is_vertical_upright = is_upright;
            style.is_vertical_punctuation = is_punctuation;
            style.text_combine_upright = fi->desc.text_combine_upright_;
            style.is_emoji = shaped.is_emoji;

            if (is_vertical) {
                batcher->addText(shaped.blob, (double)pos.x,
                                 (double)pos.y + current_l_pos.inline_offset, style);
            } else {
                batcher->addText(shaped.blob, (double)pos.x + current_l_pos.inline_offset,
                                 (double)pos.y, style);
            }
        } else {
            if (batcher) batcher->flush();
            canvas->save();

            if (is_run_combine) {
                float scale = 1.0f;
                if (shaped.width > fi->desc.size && fi->desc.size > 0) {
                    scale = (float)fi->desc.size / (float)shaped.width;
                }
                float centerX = (float)pos.x + (float)pos.width / 2.0f;
                float runY = (float)pos.y + (float)current_l_pos.inline_offset;
                canvas->translate(centerX, runY);
                canvas->scale(scale, 1.0f);

                SkFontMetrics metrics;
                analysis.chars[start].font.getMetrics(&metrics);
                // Center the run vertically in its font_size-tall slot.
                float font_size = (float)fi->desc.size;
                float run_baselineY =
                    font_size / 2.0f - (metrics.fAscent + metrics.fDescent) / 2.0f;
                SkPaint p_emoji = paint;
                if (shaped.is_emoji) p_emoji.setColor(SK_ColorWHITE);
                canvas->drawTextBlob(shaped.blob, -(float)shaped.width / 2.0f, run_baselineY + natural_dy,
                                     p_emoji);
            } else if (is_vertical) {
                TextGeometry geom(mode, pos, fi);
                SkTextBlobBuilder builder;
                SkTextBlob::Iter it(*shaped.blob);
                SkTextBlob::Iter::ExperimentalRun run;
                while (it.experimentalNext(&run)) {
                    float logical_run_start = (float)current_l_pos.inline_offset;
                    // The ink of the turned glyphs is rotated into the logical
                    // frame with them, so it is collected per glyph.
                    std::vector<SkRect> ink_bounds;
                    if (glyphInk) ink_bounds = glyphInkBounds(run);
                    if (is_upright) {
                        auto builder_run = builder.allocRunPos(run.font, run.count);
                        memcpy(builder_run.glyphs, run.glyphs, run.count * sizeof(uint16_t));
                        for (int i = 0; i < run.count; ++i) {
                            auto p = geom.getGlyphPlacement(
                                logical_run_start + run.positions[i].fX, run.positions[i].fY, true,
                                is_punctuation, run.font, run.glyphs[i]);
                            builder_run.pos[i * 2] = p.x;
                            builder_run.pos[i * 2 + 1] = p.y;
                            if (glyphInk) {
                                collectVerticalGlyphInk(glyphInk, ink_bounds[i], p, false, pos, mode);
                            }
                        }
                    } else {
                        auto builder_run = builder.allocRunRSXform(run.font, run.count);
                        memcpy(builder_run.glyphs, run.glyphs, run.count * sizeof(uint16_t));
                        for (int i = 0; i < run.count; ++i) {
                            auto p = geom.getGlyphPlacement(logical_run_start + run.positions[i].fX,
                                                            run.positions[i].fY, false, false,
                                                            run.font, run.glyphs[i]);
                            // Rotate 90 deg CW: cos=0, sin=1
                            builder_run.xforms()[i] = SkRSXform::Make(0, 1, p.x, p.y);
                            if (glyphInk) {
                                collectVerticalGlyphInk(glyphInk, ink_bounds[i], p, true, pos, mode);
                            }
                        }
                    }
                }
                sk_sp<SkTextBlob> verticalBlob = builder.make();
                SkPaint p_emoji = paint;
                if (shaped.is_emoji) p_emoji.setColor(SK_ColorWHITE);
                canvas->drawTextBlob(verticalBlob, 0, 0, p_emoji);
            } else {
                // Horizontal text: rebuild the blob with per-run baseline
                // normalization so fallback-font runs align with the primary
                // font's baseline (see comment at the top of this function).
                SkTextBlobBuilder builder;
                SkTextBlob::Iter it(*shaped.blob);
                SkTextBlob::Iter::ExperimentalRun run;
                while (it.experimentalNext(&run)) {
                    float run_baseline_shift = baselineShiftForRun(fi, run.font);
                    auto builder_run = builder.allocRunPos(run.font, run.count);
                    memcpy(builder_run.glyphs, run.glyphs, run.count * sizeof(uint16_t));
                    for (int i = 0; i < run.count; ++i) {
                        builder_run.pos[i * 2] =
                            (float)pos.x + (float)current_l_pos.inline_offset +
                            run.positions[i].fX;
                        builder_run.pos[i * 2 + 1] =
                            (float)pos.y + run.positions[i].fY + run_baseline_shift;
                    }
                    if (glyphInk) {
                        collectGlyphInk(glyphInk, run, (float)current_l_pos.inline_offset,
                                        run_baseline_shift);
                    }
                }
                sk_sp<SkTextBlob> normalizedBlob = builder.make();
                SkPaint p_emoji = paint;
                if (shaped.is_emoji) p_emoji.setColor(SK_ColorWHITE);
                canvas->drawTextBlob(normalizedBlob, 0, 0, p_emoji);
            }
            canvas->restore();
        }

        if (want_emphasis && !is_run_combine) {
            drawEmphasisRun(canvas, ctx, fi, pos, mode, paint, emphasis_spec, run_analysis, shaped,
                            (float)current_l_pos.inline_offset, is_upright, is_punctuation,
                            (analysis.bidi_level & 1) != 0);
        }

        if (is_run_combine) {
            current_l_pos.inline_offset += fi->desc.size;
            total_advance += fi->desc.size;
        } else {
            current_l_pos.inline_offset += shaped.width;
            total_advance += shaped.width;
        }
        start = end;
    }

    return total_advance;
}

}  // namespace satoru
