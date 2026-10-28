#include "pdf_renderer.h"

#include <litehtml/master_css.h>
#include <litehtml/element.h>
#include <litehtml/render_item.h>

#include <algorithm>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "api/satoru_api.h"
#include "core/container_skia.h"
#include "include/codec/SkJpegDecoder.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"
#include "include/encode/SkJpegEncoder.h"
#include "common/skia_encode.h"
#include "render_utils.h"
#include "utils/logging.h"

namespace {
std::unique_ptr<SkCodec> PdfJpegDecoder(sk_sp<const SkData> data) {
    return SkJpegDecoder::Decode(std::move(data), nullptr, nullptr);
}

bool PdfJpegEncoder(SkWStream* dst, const SkPixmap& src, int quality) {
    // 寄せ: common/skia_encode の encode_jpeg と等価 (PdfJpegEncoder 署名に適合させる)。
    auto encoded = html_to_image::encode_jpeg(src, quality);
    if (!encoded) return false;
    return dst->write(encoded->data(), encoded->size());
}

std::string replace_template_vars(std::string html, int pageNum, int totalPages) {
    size_t pos;
    std::string pageNumStr = std::to_string(pageNum);
    std::string totalPagesStr = std::to_string(totalPages);

    while ((pos = html.find("{{pageNumber}}")) != std::string::npos) {
        html.replace(pos, 14, pageNumStr);
    }
    while ((pos = html.find("{{totalPages}}")) != std::string::npos) {
        html.replace(pos, 14, totalPagesStr);
    }
    return html;
}

void render_template(const std::string& html, int width, int height, SkCanvas* canvas,
                     SatoruContext& context, const char* master_css, const char* user_css,
                     litehtml::media_type media_type) {
    if (html.empty()) return;
    container_skia container(width, height, canvas, context, nullptr, false, media_type);
    auto doc = litehtml::document::createFromString(html.c_str(), &container, master_css, user_css,
                                                    context.getPageCss());
    if (doc) {
        doc->render(width);
        doc->draw(0, 0, 0, nullptr);
        container.flush();
    }
}

// Reusable layout for a header/footer template. A template without
// {{pageNumber}}/{{totalPages}} interpolates to the same HTML on every page, so its
// document is created + laid out once and only re-drawn (canvas swap) per page.
// A template that does interpolate page numbers produces a distinct string per page;
// its text is part of the layout, so it still lays out once per page -- the cache
// simply keeps the latest one instead of accumulating documents.
class TemplateDocumentCache {
   public:
    // Lay the template out if the cached document does not match html/width/height.
    int measure(const std::string& html, int width, int height, SatoruContext& context,
                const char* master_css, const char* user_css, litehtml::media_type media_type) {
        if (!ensure_layout(html, width, height, context, master_css, user_css, media_type))
            return 0;
        int measured = (int)document_->height();
        return measured > 0 ? measured : 0;
    }

    void draw(const std::string& html, int width, int height, SkCanvas* canvas,
              SatoruContext& context, const char* master_css, const char* user_css,
              litehtml::media_type media_type) {
        if (html.empty()) return;
        if (!ensure_layout(html, width, height, context, master_css, user_css, media_type)) return;
        container_->reset();
        container_->set_canvas(canvas);
        container_->set_height(height);
        container_->set_tagging(false);
        document_->draw(0, 0, 0, nullptr);
        container_->flush();
    }

   private:
    bool ensure_layout(const std::string& html, int width, int height, SatoruContext& context,
                       const char* master_css, const char* user_css,
                       litehtml::media_type media_type) {
        if (html.empty()) return false;
        if (document_ && html == html_ && width == width_ && height == height_) return true;
        // The document owns the fonts it registered with the container, and its
        // destructor calls container->delete_font(), so drop it before the container.
        document_.reset();
        container_.reset();
        container_ = std::make_unique<container_skia>(width, height, nullptr, context, nullptr,
                                                      false, media_type);
        auto doc = litehtml::document::createFromString(html.c_str(), container_.get(), master_css,
                                                        user_css, context.getPageCss());
        if (!doc) return false;
        doc->render(width);
        document_ = std::move(doc);
        html_ = html;
        width_ = width;
        height_ = height;
        return true;
    }

    std::unique_ptr<container_skia> container_;
    litehtml::document::ptr document_;
    std::string html_;
    int width_ = -1;
    int height_ = -1;
};

// Footer band height. The footer has always been drawn inside pdfMarginBottom (top edge at
// pageHeight - marginBottom), so a footer taller than the margin was clipped and, with the
// default pdfMarginBottom = 0, it landed at y = pageHeight (off-page, invisible).
// Measure the template and only when it is taller than the bottom margin reserve the extra
// height (the array path grows the page box; the single-HTML path shrinks the content area).
// A footer that fits the margin keeps the previous layout, so existing page counts are
// unchanged. The probe viewport is the bottom margin (min 1) so percentage-height footers
// resolve exactly as before and cannot trigger an unbounded reservation.
int measure_template_height(const std::string& html, int width, int probe_height,
                            SatoruContext& context, const char* master_css, const char* user_css,
                            litehtml::media_type media_type,
                            TemplateDocumentCache* cache = nullptr) {
    if (html.empty()) return 0;
    if (width < 1) width = 1;
    if (probe_height < 1) probe_height = 1;
    if (cache) {
        return cache->measure(html, width, probe_height, context, master_css, user_css,
                              media_type);
    }
    container_skia container(width, probe_height, nullptr, context, nullptr, false, media_type);
    auto doc = litehtml::document::createFromString(html.c_str(), &container, master_css, user_css,
                                                    context.getPageCss());
    if (!doc) return 0;
    doc->render(width);
    int measured = (int)doc->height();
    return measured > 0 ? measured : 0;
}

// ---- P2: CSS fragmentation (atomic-break) page-cut planning -------------------
//
// After the single layout pass, plan page start offsets ("cuts") in document
// coordinates. An atomic unit is a block-level child of the flow root (<body>) or a
// replaced element (img / whole table) sitting at that level. break decisions are
// taken outside render_block_context, never inside it (oracle: "atomic break").
//
// Nested wrappers: units are resolved top-down from <body>, but a body-level block
// box that is merely a *grouping wrapper* -- its in-flow content consists of block
// children only and it declares no break-* of its own -- is transparent: it is not
// a unit, its block children are resolved instead (so `break-inside:avoid` on a
// card nested in a plain <div> wrapper is honoured, as in Chromium). A box stays
// atomic when it has inline content of its own, a non-block formatting context
// (flex / grid / table / list-item), is replaced, or declares break-before/after/
// inside itself.
//
// Parent/child rule (innermost wins): at most one of a wrapper and its descendants
// is emitted as a unit -- when a wrapper is transparent only its inner boxes become
// units, and when a box is atomic its subtree is never inspected. A box is therefore
// never counted twice, and an outer avoid on the wrapper is never widened to the
// inner boxes (or vice versa).
//
// The unit list only feeds break-* handling in plan_page_cuts, so a document without
// fragmentation CSS keeps P1's fixed pixel cuts exactly (byte-identical output).
struct BreakUnit {
    int top = 0;
    int bottom = 0;
    litehtml::break_flow before = litehtml::break_flow_auto;
    litehtml::break_flow after = litehtml::break_flow_auto;
    litehtml::break_inside inside = litehtml::break_inside_auto;
};

// Does this box own a fragmentation decision (explicit break-*)? Such a box is
// always a unit, even when it only groups block children.
bool has_break_constraint(const litehtml::element* el) {
    const litehtml::css_properties& css = el->css();
    return css.get_break_before() != litehtml::break_flow_auto ||
           css.get_break_after() != litehtml::break_flow_auto ||
           css.get_break_inside() != litehtml::break_inside_auto;
}

// A grouping wrapper contributes no content of its own: only in-flow block-level
// children, no line boxes (no text / inline siblings) and no break-* of its own.
bool is_grouping_wrapper(const litehtml::element* el) {
    if (!el || el->is_replaced()) return false;
    // display:block only: flex/grid/table/list-item boxes lay their children out
    // with their own engine and stay atomic for pagination.
    if (el->css().get_display() != litehtml::display_block) return false;
    if (!el->in_normal_flow() || el->is_float()) return false;
    if (has_break_constraint(el)) return false;

    litehtml::position::vector lines;
    el->get_line_boundaries(lines);  // only this element's own inline context
    if (!lines.empty()) return false;

    bool has_block_child = false;
    for (const auto& child : el->children()) {
        if (!child) continue;
        if (!child->in_normal_flow()) continue;  // absolute/fixed/none: not content
        // Whitespace between blocks (pretty-printed markup, marked's output) generates no box.
        if (child->is_white_space()) continue;
        if (!(child->is_block_box() || child->is_replaced())) return false;
        has_block_child = true;
    }
    return has_block_child;
}

// Resolve one in-flow flow-root child into units (innermost-wins, see above).
void append_break_units(litehtml::element* el, std::vector<BreakUnit>& units) {
    if (!el) return;
    if (!el->in_normal_flow()) return;
    // Block boxes, plus replaced elements (img / whole table).
    if (!(el->is_block_box() || el->is_replaced())) return;

    if (is_grouping_wrapper(el)) {
        for (const auto& child : el->children()) append_break_units(child.get(), units);
        return;
    }

    // get_placement() is the content box: widen it by padding and border so that a cut taken at
    // the unit's edge is the edge of the box (a padded <pre> otherwise leaves its top padding
    // behind on the previous page).
    litehtml::position p = el->get_placement();
    if (p.height <= 0) return;
    litehtml::pixel_t above = 0, below = 0;
    if (const auto ri = el->get_render_item()) {
        above = ri->padding_top() + ri->border_top();
        below = ri->padding_bottom() + ri->border_bottom();
    }
    BreakUnit u;
    u.top = (int)(p.y - above);
    u.bottom = (int)(p.y + p.height + below);
    u.before = el->css().get_break_before();
    u.after = el->css().get_break_after();
    u.inside = el->css().get_break_inside();
    units.push_back(u);
}

std::vector<BreakUnit> collect_break_units(litehtml::element* root) {
    std::vector<BreakUnit> units;
    if (!root) return units;

    litehtml::element* flow = root;
    for (const auto& child : root->children()) {
        if (child && child->tag() == litehtml::_body_) {
            flow = child.get();
            break;
        }
    }

    for (const auto& child : flow->children()) append_break_units(child.get(), units);

    std::sort(units.begin(), units.end(),
              [](const BreakUnit& a, const BreakUnit& b) { return a.top < b.top; });
    return units;
}

// ---- box-decoration-break: clone ---------------------------------------------
//
// A block box that straddles a page cut is normally drawn once and sliced by the page clip
// (box-decoration-break: slice). With `clone` every page paints a complete box (all borders and
// rounded corners, background restarted) for the part of the box that lies on that page: the
// element's border box in document coordinates is recorded here, and the page loop hands the
// visible band to the document (document::set_fragment_band) before drawing.
struct CloneBox {
    const litehtml::element* el = nullptr;
    int top = 0;     // border box, document coordinates
    int bottom = 0;
};

void collect_clone_boxes(const std::shared_ptr<litehtml::render_item>& ri,
                         std::vector<CloneBox>& out) {
    if (!ri) return;
    const auto& el = ri->src_el();
    if (el && el->css().get_box_decoration_break() == litehtml::box_decoration_break_clone) {
        const litehtml::style_display d = el->css().get_display();
        if (d != litehtml::display_inline && d != litehtml::display_none &&
            d != litehtml::display_table_row && d != litehtml::display_inline_text) {
            litehtml::position p = ri->get_placement();
            const litehtml::pixel_t above = ri->padding_top() + ri->border_top();
            const litehtml::pixel_t extra =
                above + ri->padding_bottom() + ri->border_bottom();
            CloneBox b;
            b.el = el.get();
            b.top = (int)(p.y - above);
            b.bottom = (int)(p.y - above + p.height + extra);
            if (b.bottom > b.top) out.push_back(b);
        }
    }
    for (const auto& child : ri->children()) collect_clone_boxes(child, out);
}

// ---- P3: inline (line-box) fragmentation data ---------------------------------
//
// Line-level fragmentation is planned on top of the P2 atomic-break cuts. A text
// paragraph is represented by the line boxes of one inline formatting context; the
// pass snaps a page cut to a line boundary (a line box is never split) and then
// honours orphans/widows. Floated boxes are kept whole in one fragment (provisional).
struct LineGroup {
    std::vector<int> tops;     // absolute line-box top edges, in order
    std::vector<int> bottoms;  // absolute line-box bottom edges, in order
    int orphans = 2;           // minimum lines kept at the bottom of a page
    int widows = 2;            // minimum lines kept at the top of the next page
};

struct FloatBox {
    int top = 0;
    int bottom = 0;
};

// ---- P4: table fragmentation -------------------------------------------------
//
// render_item_table / render_item_table_row are a self-contained layout engine
// (rows are placed by table_grid, cells are painted by render_item_table), so
// table fragmentation is handled separately from the P3 line-box pass:
//   - a <tr> is the atomic pagination unit (a row is never split unless it is
//     taller than a page); rows covered by a rowspan>1 cell are merged into one
//     atomic box (next-page-first, cell-internal splitting is out of scope),
//   - a header group (display:table-header-group / <thead>) is re-painted at the
//     top of every continuation page.
struct RepeatHeader {
    int table_top = 0;
    int table_bottom = 0;
    int header_top = 0;
    int header_height = 0;
};

// Atomic pagination boxes for a table: one box per row, with rows covered by a
// rowspan>1 cell merged (so the spanned cell is never split across pages). The
// row rects come from the table render item (table rows are placed by the table
// engine, not by the generic block layout, so element::get_placement is empty).
void collect_table_rows(const litehtml::element* table, std::vector<FloatBox>& boxes) {
    if (!table) return;
    auto ri = const_cast<litehtml::element*>(table)->get_render_item();
    if (!ri) return;
    litehtml::position::vector row_rects;
    ri->get_table_row_boundaries(row_rects);
    for (const auto& r : row_rects) {
        if (r.height > 0) boxes.push_back({(int)r.y, (int)(r.y + r.height)});
    }
}

// Header groups of every table that carry a display:table-header-group (or a
// <thead> tag, which the engine maps to a row group by default). The band is the
// union of the header rows' rects, in document coordinates.
void collect_repeat_headers(const litehtml::element* el, std::vector<RepeatHeader>& out) {
    if (!el) return;
    if (el->css().get_display() == litehtml::display_none) return;
    const litehtml::style_display disp = el->css().get_display();
    if (disp == litehtml::display_table || disp == litehtml::display_inline_table) {
        auto ri = const_cast<litehtml::element*>(el)->get_render_item();
        litehtml::position header_box;
        if (ri && ri->get_table_header_boundary(header_box) && header_box.height > 0) {
            litehtml::position tp = ri->get_placement();
            RepeatHeader rh;
            rh.table_top = (int)tp.y;
            rh.table_bottom = (int)(tp.y + tp.height);
            rh.header_top = (int)header_box.y;
            rh.header_height = (int)header_box.height;
            out.push_back(rh);
        }
    }
    for (const auto& child : el->children()) collect_repeat_headers(child.get(), out);
}

// Walk the flow subtree collecting the line boxes of every inline formatting
// context (paragraph) and every floated box. Coordinates are document-space
// (matching element::get_placement and the draw offset used when slicing pages).
void collect_line_groups(const litehtml::element* el, std::vector<LineGroup>& groups,
                         std::vector<FloatBox>& floats) {
    if (!el) return;
    if (el->css().get_display() == litehtml::display_none) return;
    const litehtml::element_position pos = el->css().get_position();
    if (pos == litehtml::element_position_absolute || pos == litehtml::element_position_fixed)
        return;

    // P4: a table is fragmented by rows (its own engine), not as one atomic box.
    // Push each row (rowspan groups merged) as an atomic box and do not descend
    // into cells: line fragmentation inside a cell is out of scope.
    const litehtml::style_display disp = el->css().get_display();
    if (disp == litehtml::display_table || disp == litehtml::display_inline_table) {
        collect_table_rows(el, floats);
        return;
    }

    // Flex / grid containers are atomic for pagination (P3): they are never
    // line-fragmented. Descend no further; instead treat the whole container like a
    // float so a container straddling a cut moves wholly to the next fragment.
    if (disp == litehtml::display_flex || disp == litehtml::display_inline_flex ||
        disp == litehtml::display_grid || disp == litehtml::display_inline_grid) {
        litehtml::position p = el->get_placement();
        if (p.height > 0) floats.push_back({(int)p.y, (int)(p.y + p.height)});
        return;
    }

    const bool is_float = el->is_float() && el->in_normal_flow();
    if (is_float) {
        litehtml::position p = el->get_placement();
        if (p.height > 0) floats.push_back({(int)p.y, (int)(p.y + p.height)});
    }

    // A float is treated atomically: its own lines do not create a paragraph group.
    if (!is_float) {
        litehtml::position::vector boxes;
        el->get_line_boundaries(boxes);
        if (!boxes.empty()) {
            LineGroup g;
            g.orphans = el->css().get_orphans();
            g.widows = el->css().get_widows();
            if (g.orphans < 1) g.orphans = 1;
            if (g.widows < 1) g.widows = 1;
            for (const auto& b : boxes) {
                if (b.height <= 0) continue;
                g.tops.push_back((int)b.y);
                g.bottoms.push_back((int)(b.y + b.height));
            }
            if (!g.tops.empty()) groups.push_back(std::move(g));
        }
    }

    for (const auto& child : el->children()) collect_line_groups(child.get(), groups, floats);
}

// Snap a natural cut so that no line box / float is split, then apply
// orphans/widows to the paragraph the cut falls inside. Never returns a cut that
// is not after `pos` (the caller falls back to the pixel cut in that case).
int snap_cut_to_content(int cut, int pos, const std::vector<LineGroup>& groups,
                        const std::vector<FloatBox>& floats) {
    // 1) A straddling line box or float moves wholly to the next page.
    for (const auto& f : floats)
        if (f.top < cut && cut < f.bottom && f.top > pos) cut = std::min(cut, f.top);
    for (const auto& g : groups)
        for (size_t i = 0; i < g.tops.size(); ++i)
            if (g.tops[i] < cut && cut < g.bottoms[i] && g.tops[i] > pos)
                cut = std::min(cut, g.tops[i]);

    // 2) orphans / widows within the split paragraph.
    for (const auto& g : groups) {
        const int n = (int)g.tops.size();
        if (n < 2) continue;
        int k = 0;  // number of lines entirely above the cut
        while (k < n && g.bottoms[k] <= cut) k++;
        if (k <= 0 || k >= n) continue;              // not split (or straddle left over)
        if (g.tops[k] < cut && cut < g.bottoms[k]) continue;

        // First line of the fragment that lives on the current page.
        int first_on_page = 0;
        while (first_on_page < n && g.bottoms[first_on_page] <= pos) first_on_page++;
        const int above = k - first_on_page;         // lines of this page's fragment
        const int below = n - k;                     // lines on the next page

        int new_k = k;
        if (above < g.orphans) {
            new_k = first_on_page;                   // move the whole fragment to the next page
        } else if (below < g.widows) {
            if (n >= g.orphans + g.widows) {
                new_k = std::max(first_on_page + g.orphans, n - g.widows);
            }
        }
        if (new_k != k) {
            const int nc = (new_k == 0) ? g.tops[0] : g.tops[new_k];
            if (nc > pos) cut = nc;
        }
    }
    return cut;
}

// One planned page: its document start offset plus the repeated-header band to
// re-paint at the top (header_top < 0 / header_height == 0: none). table_bottom is
// the document bottom of the table whose header repeats: the continuation page
// offsets only that table's slice by the header height, so the band it may paint
// in ends there (INT_MAX: no repeated header / table).
struct PageCut {
    int offset = 0;
    int header_top = -1;
    int header_height = 0;
    int table_bottom = INT_MAX;
};

// Plan page-start offsets. With no break-* in the document this reproduces P1's
// fixed pixel cuts (0, areaHeight, 2*areaHeight, ...). break-* can only move a cut
// earlier than the pixel cut:
//   - break-before/after: page forces a cut at that unit edge,
//   - break-inside: avoid pulls the cut back to the top of a straddling unit,
//   - break-before/after: avoid pulls it back to the previous unit's top so the
//     two neighbours stay together.
std::vector<PageCut> plan_page_cuts(const std::vector<BreakUnit>& units,
                                    const std::vector<LineGroup>& line_groups,
                                    const std::vector<FloatBox>& floats,
                                    const std::vector<RepeatHeader>& repeat_headers,
                                    int area_height, int doc_height) {
    std::vector<PageCut> pages;
    pages.push_back(PageCut{0, -1, 0});
    if (area_height < 1) area_height = 1;

    int pos = 0;
    while (pos < doc_height) {
        // P4: a table whose header repeats and which continues from a previous page
        // reserves its header height at the top of this page, so the body rows do
        // not overlap the repeated header. The reserve belongs to the page that
        // starts at `pos` (pages.back()), not to the page starting at `cut`.
        int header_top = -1;
        int header_height = 0;
        int table_bottom = 0;
        for (const auto& rh : repeat_headers) {
            if (rh.table_top < pos && rh.table_bottom > pos) {
                // Repeat the tallest header; the offset band covers every table continuing
                // from this page (nested tables included), so only content after all of
                // them keeps its own position.
                table_bottom = std::max(table_bottom, rh.table_bottom);
                if (rh.header_height > header_height) {
                    header_height = rh.header_height;
                    header_top = rh.header_top;
                }
            }
        }
        pages.back().header_top = header_top;
        pages.back().header_height = header_height;
        pages.back().table_bottom = header_height > 0 ? table_bottom : INT_MAX;
        int limit = pos + area_height - header_height;
        if (limit <= pos) limit = pos + area_height;  // header taller than page: no reserve

        // 1) Forced breaks (break-before/after: page): the earliest edge after pos
        //    that still fits on this page ends it early.
        int forced = INT_MAX;
        for (const auto& u : units) {
            if (u.before == litehtml::break_flow_page && u.top > pos) forced = std::min(forced, u.top);
            if (u.after == litehtml::break_flow_page && u.bottom > pos)
                forced = std::min(forced, u.bottom);
        }

        int cut;
        if (forced <= limit) {
            cut = forced;
        } else {
            cut = limit;

            // 2) break-inside: avoid — a unit straddling the cut moves down whole.
            for (const auto& u : units) {
                if (u.inside == litehtml::break_inside_avoid && u.top > pos && u.top < cut &&
                    u.bottom > cut)
                    cut = std::min(cut, u.top);
            }

            // 3) break-after/before: avoid — the cut must not fall between two
            //    neighbours; move it to the top of the already-fitting first one.
            bool inside_unit = false;
            for (const auto& u : units) {
                if (u.top < cut && cut < u.bottom) {
                    inside_unit = true;
                    break;
                }
            }
            if (!inside_unit) {
                const BreakUnit* a = nullptr;  // last unit entirely above the cut
                const BreakUnit* b = nullptr;  // first unit at/after the cut
                for (const auto& u : units) {
                    if (u.bottom <= cut && (!a || u.bottom > a->bottom)) a = &u;
                    if (u.top >= cut && (!b || u.top < b->top)) b = &u;
                }
                const bool avoid_between = (a && a->after == litehtml::break_flow_avoid) ||
                                           (b && b->before == litehtml::break_flow_avoid);
                if (avoid_between && a && a->top > pos) cut = a->top;
            }

            // 4) P3: never split a line box or a float; honour orphans/widows.
            //    With no straddling content this is a no-op, so a document without
            //    fragmentation CSS still cuts exactly as P1/P2 did.
            cut = snap_cut_to_content(cut, pos, line_groups, floats);
        }

        if (cut <= pos) cut = limit;  // no forward progress: fall back to the pixel cut
        if (cut <= pos || cut >= doc_height) break;
        pages.push_back(PageCut{cut, -1, 0});
        pos = cut;
    }

    return pages;
}

// ---- P5: @page rule (size / margin) ------------------------------------------
//
// litehtml discards the @page at-rule (stylesheet.cpp falls through to
// "unrecognized rule"), so the single-HTML pagination path extracts the page box
// itself, from every stylesheet that reaches the document (master CSS, user CSS
// and inline <style> blocks). Only `size` and `margin` are honoured:
//   - `size` sets the page box (px @96dpi) and, because SkPDF writes the MediaBox
//     in points, switches the page to a 0.75 px->pt canvas scale,
//   - `margin` overrides the SatoruRenderOptions pdfMargin* px margins.
// Named pages (page:foo), :left/:right/:first pseudo pages and page counters are
// out of scope (YAGNI).
struct PageRule {
    bool has_size = false;
    float width_px = 0.f;
    float height_px = 0.f;
    bool has_margin = false;
    float margin_top = 0.f;
    float margin_right = 0.f;
    float margin_bottom = 0.f;
    float margin_left = 0.f;
};

std::string ascii_lower(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

std::string trim_ws(const std::string& s) {
    const char* ws = " \t\r\n\f";
    size_t b = s.find_first_not_of(ws);
    if (b == std::string::npos) return "";
    size_t e = s.find_last_not_of(ws);
    return s.substr(b, e - b + 1);
}

std::vector<std::string> split_ws(const std::string& s) {
    std::vector<std::string> out;
    size_t i = 0;
    while (i < s.size()) {
        while (i < s.size() && std::isspace((unsigned char)s[i])) i++;
        size_t b = i;
        while (i < s.size() && !std::isspace((unsigned char)s[i])) i++;
        if (i > b) out.push_back(s.substr(b, i - b));
    }
    return out;
}

// CSS length -> px at 96dpi. Unitless values are accepted as px (only 0 is valid
// CSS, but accepting the number is harmless).
bool css_length_to_px(const std::string& token, float& out_px) {
    std::string t = trim_ws(token);
    if (t.empty()) return false;
    const char* begin = t.c_str();
    char* end = nullptr;
    float v = std::strtof(begin, &end);
    if (end == begin) return false;
    std::string unit = ascii_lower(trim_ws(std::string(end)));
    if (unit.empty() || unit == "px") out_px = v;
    else if (unit == "pt") out_px = v * 96.f / 72.f;
    else if (unit == "pc") out_px = v * 16.f;
    else if (unit == "in") out_px = v * 96.f;
    else if (unit == "cm") out_px = v * 96.f / 2.54f;
    else if (unit == "mm") out_px = v * 96.f / 25.4f;
    else if (unit == "q") out_px = v * 96.f / 25.4f / 4.f;
    else return false;
    return true;
}

// ISO/US named page sizes, expressed in mm (converted to px by the caller).
bool named_page_size(const std::string& name, float& w_px, float& h_px) {
    static const struct {
        const char* name;
        float w_mm;
        float h_mm;
    } kSizes[] = {
        {"a3", 297.f, 420.f},   {"a4", 210.f, 297.f},     {"a5", 148.f, 210.f},
        {"b4", 250.f, 353.f},   {"b5", 176.f, 250.f},     {"letter", 215.9f, 279.4f},
        {"legal", 215.9f, 355.6f}, {"ledger", 279.4f, 431.8f}, {"tabloid", 279.4f, 431.8f},
    };
    for (const auto& s : kSizes) {
        if (name == s.name) {
            w_px = s.w_mm * 96.f / 25.4f;
            h_px = s.h_mm * 96.f / 25.4f;
            return true;
        }
    }
    return false;
}

// `size`: [ <length>{1,2} | <page-size> ] || [ portrait | landscape ]
bool parse_page_size(const std::string& value, float& w_px, float& h_px) {
    std::vector<std::string> dims;
    bool landscape = false;
    for (const auto& tok : split_ws(value)) {
        std::string lt = ascii_lower(tok);
        if (lt == "portrait") continue;
        if (lt == "landscape") {
            landscape = true;
            continue;
        }
        dims.push_back(tok);
    }

    float w = 0.f, h = 0.f;
    if (dims.size() == 1) {
        if (named_page_size(ascii_lower(dims[0]), w, h)) {
            // named: already in px
        } else if (css_length_to_px(dims[0], w)) {
            h = w;
        } else {
            return false;
        }
    } else if (dims.size() == 2) {
        if (!css_length_to_px(dims[0], w) || !css_length_to_px(dims[1], h)) return false;
    } else {
        return false;
    }
    if (landscape) std::swap(w, h);
    w_px = w;
    h_px = h;
    return true;
}

// `margin`: <length>{1,4}
bool parse_margin_shorthand(const std::string& value, float& t, float& r, float& b, float& l) {
    std::vector<std::string> v = split_ws(value);
    if (v.empty() || v.size() > 4) return false;
    float px[4] = {0.f, 0.f, 0.f, 0.f};
    for (size_t i = 0; i < v.size(); ++i)
        if (!css_length_to_px(v[i], px[i])) return false;
    switch (v.size()) {
        case 1: t = r = b = l = px[0]; break;
        case 2: t = b = px[0]; r = l = px[1]; break;
        case 3: t = px[0]; r = l = px[1]; b = px[2]; break;
        default: t = px[0]; r = px[1]; b = px[2]; l = px[3]; break;
    }
    return true;
}

void parse_page_declarations(const std::string& block, PageRule& rule) {
    size_t start = 0;
    while (start <= block.size()) {
        size_t end = block.find(';', start);
        std::string decl =
            block.substr(start, (end == std::string::npos ? block.size() : end) - start);
        size_t colon = decl.find(':');
        if (colon != std::string::npos) {
            std::string prop = ascii_lower(trim_ws(decl.substr(0, colon)));
            std::string val = trim_ws(decl.substr(colon + 1));
            if (prop == "size") {
                float w, h;
                if (parse_page_size(val, w, h)) {
                    rule.has_size = true;
                    rule.width_px = w;
                    rule.height_px = h;
                }
            } else if (prop == "margin") {
                float t, r, b, l;
                if (parse_margin_shorthand(val, t, r, b, l)) {
                    rule.has_margin = true;
                    rule.margin_top = t;
                    rule.margin_right = r;
                    rule.margin_bottom = b;
                    rule.margin_left = l;
                }
            } else if (prop == "margin-top" || prop == "margin-right" ||
                       prop == "margin-bottom" || prop == "margin-left") {
                float v;
                if (css_length_to_px(val, v)) {
                    rule.has_margin = true;
                    if (prop == "margin-top") rule.margin_top = v;
                    else if (prop == "margin-right") rule.margin_right = v;
                    else if (prop == "margin-bottom") rule.margin_bottom = v;
                    else rule.margin_left = v;
                }
            }
        }
        if (end == std::string::npos) break;
        start = end + 1;
    }
}

// Scan a stylesheet for @page blocks (bare @page only; pseudo/named pages are
// ignored). Later rules win, matching the CSS cascade for identical specificity.
void parse_page_rules(const std::string& css, PageRule& rule) {
    std::string lower = ascii_lower(css);
    size_t pos = 0;
    while ((pos = lower.find("@page", pos)) != std::string::npos) {
        size_t i = pos + 5;
        while (i < css.size() && std::isspace((unsigned char)css[i])) i++;
        // Pseudo/named page selectors (@page :first, @page foo) are out of scope.
        if (i < css.size() && css[i] == ':') {
            pos = i;
            continue;
        }
        if (i >= css.size() || css[i] != '{') {
            pos = i;
            continue;
        }
        int depth = 0;
        size_t j = i;
        for (; j < css.size(); ++j) {
            if (css[j] == '{') depth++;
            else if (css[j] == '}') {
                if (--depth == 0) break;
            }
        }
        parse_page_declarations(css.substr(i + 1, (j > i ? j - i - 1 : 0)), rule);
        pos = (j < css.size()) ? j + 1 : css.size();
    }
}

// Concatenated contents of every inline <style> block (litehtml parses these as
// document CSS, so an @page rule written there must be seen by the extractor too).
std::string extract_style_blocks(const std::string& html) {
    std::string out;
    std::string lower = ascii_lower(html);
    size_t pos = 0;
    while ((pos = lower.find("<style", pos)) != std::string::npos) {
        size_t gt = html.find('>', pos);
        if (gt == std::string::npos) break;
        size_t close = lower.find("</style", gt);
        if (close == std::string::npos) break;
        out += html.substr(gt + 1, close - gt - 1);
        out += "\n";
        pos = close + 7;
    }
    return out;
}
}  // namespace

sk_sp<SkData> renderDocumentToPdf(SatoruInstance* inst, int width, int height,
                                  const SatoruRenderOptions& options) {
    if (!inst->doc || !inst->render_container) {
        SATORU_LOG_ERROR("[Satoru] renderDocumentToPdf FAILED: null doc/container");
        return nullptr;
    }
    width = normalize_viewport_width(width);

    int content_width = width;
    int content_height = (height > 0) ? height : (int)inst->doc->height();
    if (content_height < 1) content_height = 1;

    int src_x = options.cropX;
    int src_y = options.cropY;
    int src_w = options.cropWidth > 0 ? options.cropWidth : content_width;
    int src_h = options.cropHeight > 0 ? options.cropHeight : content_height;

    int out_width = options.outputWidth > 0 ? options.outputWidth : src_w;
    int out_height = options.outputHeight > 0 ? options.outputHeight : src_h;

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    SkCanvas* canvas = pdf_doc->beginPage((SkScalar)out_width, (SkScalar)out_height);
    if (canvas) {
        if (options.outputWidth > 0 || options.outputHeight > 0) {
            apply_resize_transform(canvas, src_w, src_h, options);
        }

        inst->render_container->reset();
        inst->render_container->set_canvas(canvas);
        inst->render_container->set_height(content_height);
        inst->render_container->set_tagging(false);

        litehtml::media_type media_type =
            (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;
        if (inst->render_container->get_media_type() != media_type) {
            inst->render_container->set_media_type(media_type);
            inst->doc->media_changed();
            inst->doc->render(width);
        }

        litehtml::position clip(0, 0, src_w, src_h);
        inst->doc->draw(0, -src_x, -src_y, &clip);
        inst->render_container->flush();

        pdf_doc->endPage();
    }
    pdf_doc->close();
    return stream.detachAsData();
}

sk_sp<SkData> renderHtmlsToPdf(const std::vector<std::string>& htmls, int width, int height,
                               SatoruContext& context, const char* master_css, const char* user_css,
                               const SatoruRenderOptions& options) {
    if (htmls.empty()) return nullptr;
    width = normalize_viewport_width(width);

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    std::string css = master_css ? master_css : litehtml::master_css;
    css += "\nbr { display: -litehtml-br !important; }\n";

    int pageNum = 1;
    int totalPages = (int)htmls.size();

    for (const auto& html : htmls) {
        // Measure pass
        litehtml::media_type media_type =
            (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;

        int margin_top = options.pdfMarginTop;
        int margin_bottom = options.pdfMarginBottom;
        int margin_left = options.pdfMarginLeft;
        int margin_right = options.pdfMarginRight;

        int content_width = width - margin_left - margin_right;
        if (content_width < 1) content_width = 1;

        // Footer band: reserve the measured footer height only when it exceeds the bottom
        // margin; a footer that fits keeps the legacy geometry (page count unchanged).
        int footer_band = margin_bottom;
        std::string footer_html;
        if (!options.pdfFooter.empty()) {
            footer_html = replace_template_vars(options.pdfFooter, pageNum, totalPages);
            int footer_height = measure_template_height(footer_html, content_width, margin_bottom,
                                                        context, css.c_str(), user_css, media_type);
            if (footer_height > footer_band) footer_band = footer_height;
        }

        container_skia measure_container(content_width,
                                         height > 0 ? height : k_default_viewport_height, nullptr,
                                         context, nullptr, false, media_type);
        auto measure_doc = litehtml::document::createFromString(html.c_str(), &measure_container,
                                                                css.c_str(), user_css,
                                                                context.getPageCss());
        if (!measure_doc) continue;

        measure_doc->render(content_width);

        int measured_height = (height > 0) ? height : (int)measure_doc->height();
        int full_page_height = measured_height + margin_top + footer_band;
        if (full_page_height < 1) full_page_height = 1;

        SkCanvas* canvas = pdf_doc->beginPage((SkScalar)width, (SkScalar)full_page_height);
        if (!canvas) continue;

        if (options.backgroundColor != 0) {
            SkPaint paint;
            paint.setColor(options.backgroundColor);
            canvas->drawRect(SkRect::MakeWH(width, full_page_height), paint);
        }

        // Render Header
        if (!options.pdfHeader.empty()) {
            std::string headerHtml = replace_template_vars(options.pdfHeader, pageNum, totalPages);
            canvas->save();
            canvas->translate((SkScalar)margin_left, 0);
            render_template(headerHtml, content_width, margin_top, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        // Render Footer
        if (!options.pdfFooter.empty()) {
            canvas->save();
            canvas->translate((SkScalar)margin_left, (SkScalar)(full_page_height - footer_band));
            render_template(footer_html, content_width, footer_band, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        // Render Content
        canvas->save();
        canvas->translate((SkScalar)margin_left, (SkScalar)margin_top);

        container_skia render_container(content_width, measured_height, canvas, context, nullptr,
                                        false, media_type);
        auto render_doc = litehtml::document::createFromString(html.c_str(), &render_container,
                                                               css.c_str(), user_css,
                                                               context.getPageCss());
        if (!render_doc) continue;
        render_doc->render(content_width);
        render_doc->draw(0, 0, 0, nullptr);
        render_container.flush();

        canvas->restore();

        pdf_doc->endPage();
        pageNum++;
    }

    pdf_doc->close();

    return stream.detachAsData();
}

// P1: single-HTML multi-page PDF via "Layout once + Slice". This path is independent of
// renderHtmlsToPdf's array (one-item-per-page) approach:
//   1) lay the document out exactly once at contentWidth,
//   2) plan the page start offsets ("cuts") from the fragmentation CSS (P2),
//   3) for each page: beginPage -> (per-page background) -> header/footer re-render (same as
//      renderHtmlsToPdf today) -> draw the shared document shifted by -cut[page] and clipped to
//      the page's slice -> endPage.
//
// pageHeight = height(>0) : options.outputHeight(>0) : A4 @96dpi (1123px). contentAreaHeight is
// pageHeight minus the top/bottom margins.
//
// P2 adds CSS fragmentation on top of the P1 "layout once + slice" model (see plan_page_cuts):
// top-level block children / replaced elements are atomic units, break-before/after:page force a
// cut at a unit edge, break-inside:avoid (and break-before/after:avoid) move a cut earlier. A
// document without break-* still cuts at the fixed P1 pixel positions.
//
// P3 adds line-box cut snapping + orphans/widows. P4 adds table fragmentation: a table is broken
// by rows (<tr> is the atomic unit, rowspan groups merged) and a table-header-group (<thead>) is
// re-painted at the top of every continuation page, reserving its height so the body does not
// overlap it.
//
// P5 adds the @page rule: `size` sets the page box (and switches the MediaBox to points) and
// `margin` overrides the SatoruRenderOptions px margins. Page numbers are already available to the
// header/footer templates as {{pageNumber}} / {{totalPages}}, so no counter(page) support is added.
//
// Notes / accepted limitations:
//   - Without break-* the slice cuts between the layout's painted pixels; a line/element
//     straddling a page boundary is simply clipped (P1 behaviour, unchanged).
//   - position:fixed: litehtml draws fixed elements ignoring the doc->draw (x,y) offset
//     (render_item.cpp draws them with draw(hdc, 0, 0, ...)), so the vertical page shift (which is
//     applied through the draw offset rather than a canvas translate) leaves them in place ->
//     they are re-painted at the same viewport position on every page.
//   - position:sticky: litehtml has no sticky positioning (element_position only has
//     static/relative/absolute/fixed), so a "sticky" element is laid out as normal flow and
//     painted once, wherever it lands. Provisionally accepted.
sk_sp<SkData> renderHtmlToPdf(const std::string& html, int width, int height,
                              SatoruContext& context, const char* master_css, const char* user_css,
                              const SatoruRenderOptions& options) {
    if (html.empty()) return nullptr;
    width = normalize_viewport_width(width);

    std::string css = master_css ? master_css : litehtml::master_css;
    css += "\nbr { display: -litehtml-br !important; }\n";

    // P5: @page { size / margin }. litehtml drops @page, so extract it here from
    // every stylesheet that reaches the document (master + user + inline <style>).
    // @page overrides the SatoruRenderOptions px margins; a `size` also overrides
    // the page box derived from the width/height arguments (the caller's explicit
    // CSS intent wins). A document without @page is completely unaffected.
    PageRule page_rule;
    {
        std::string page_css = css;
        if (user_css) {
            page_css += "\n";
            page_css += user_css;
        }
        page_css += "\n";
        page_css += extract_style_blocks(html);
        parse_page_rules(page_css, page_rule);
    }

    int margin_top = options.pdfMarginTop;
    int margin_bottom = options.pdfMarginBottom;
    int margin_left = options.pdfMarginLeft;
    int margin_right = options.pdfMarginRight;
    if (page_rule.has_margin) {
        margin_top = (int)std::lround(page_rule.margin_top);
        margin_right = (int)std::lround(page_rule.margin_right);
        margin_bottom = (int)std::lround(page_rule.margin_bottom);
        margin_left = (int)std::lround(page_rule.margin_left);
        if (margin_top < 0) margin_top = 0;
        if (margin_right < 0) margin_right = 0;
        if (margin_bottom < 0) margin_bottom = 0;
        if (margin_left < 0) margin_left = 0;
    }

    // Page box (px @96dpi): @page size wins, else the render width and the
    // height > outputHeight > A4 (1123px) fallback.
    int page_width = width;
    int page_height = (height > 0) ? height
                                   : (options.outputHeight > 0 ? options.outputHeight : 1123);
    if (page_rule.has_size) {
        page_width = (int)std::lround(page_rule.width_px);
        page_height = (int)std::lround(page_rule.height_px);
    }
    if (page_width < 1) page_width = 1;
    if (page_height < 1) page_height = 1;

    int content_width = page_width - margin_left - margin_right;
    if (content_width < 1) content_width = 1;

    litehtml::media_type media_type =
        (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;

    // Header/footer layout caches. A template without page-number placeholders renders
    // the same HTML on all pages, so it is laid out once and re-drawn per page. The probe
    // seeds the footer cache: when the footer fits the bottom margin, footer_band equals
    // the probe viewport and the first page's draw reuses the measured document.
    TemplateDocumentCache header_cache;
    TemplateDocumentCache footer_cache;

    // Footer band: only a footer taller than the bottom margin grows the band (the content
    // area shrinks accordingly); otherwise the historical layout and page count are kept.
    // Measured with page 1 / total 1, which is enough for a height estimate.
    int footer_band = margin_bottom;
    if (!options.pdfFooter.empty()) {
        std::string footer_probe = replace_template_vars(options.pdfFooter, 1, 1);
        int footer_height = measure_template_height(footer_probe, content_width, margin_bottom,
                                                    context, css.c_str(), user_css, media_type,
                                                    &footer_cache);
        if (footer_height > footer_band) footer_band = footer_height;
    }
    if (footer_band > page_height) footer_band = page_height;

    int content_area_height = page_height - margin_top - footer_band;
    if (content_area_height < 1) content_area_height = 1;

    // SkPDF writes the MediaBox in points, while the layout works in CSS px. When
    // @page size is given the page is emitted at pt (px * 72/96) with a matching
    // canvas scale, so an @page A4 page matches a browser's A4 pt size. Without
    // @page size the legacy px-as-pt convention is preserved (no API change).
    const float kPtPerPx = 72.0f / 96.0f;
    const float pdf_page_width = page_rule.has_size ? page_rule.width_px * kPtPerPx
                                                     : (float)page_width;
    const float pdf_page_height = page_rule.has_size ? page_rule.height_px * kPtPerPx
                                                      : (float)page_height;

    // Layout once. The container is reused for every page (reset + set_canvas below), matching the
    // document-reuse pattern already used elsewhere in this file.
    container_skia container(content_width, content_area_height, nullptr, context, nullptr, false,
                             media_type);
    auto doc = litehtml::document::createFromString(html.c_str(), &container, css.c_str(), user_css,
                                                    context.getPageCss());
    if (!doc) return nullptr;

    doc->render(content_width);
    int doc_height = (int)doc->height();
    if (doc_height < 1) doc_height = 1;

    // P2: plan cut positions from the fragmentation CSS (falling back to P1's fixed
    // pixel cuts when no break-* is present). Page i starts at pages[i].offset.
    // P3: line boxes of every paragraph + floated boxes refine the cuts so a line is
    // never split and orphans/widows are honoured.
    // P4: table rows are atomic boxes (collected into float_boxes by
    // collect_line_groups) and header groups repeat on continuation pages.
    std::vector<BreakUnit> break_units = collect_break_units(doc->root().get());
    std::vector<LineGroup> line_groups;
    std::vector<FloatBox> float_boxes;
    collect_line_groups(doc->root().get(), line_groups, float_boxes);
    std::vector<RepeatHeader> repeat_headers;
    collect_repeat_headers(doc->root().get(), repeat_headers);
    std::vector<CloneBox> clone_boxes;
    collect_clone_boxes(doc->root_render(), clone_boxes);
    std::vector<PageCut> pages =
        plan_page_cuts(break_units, line_groups, float_boxes, repeat_headers, content_area_height,
                       doc_height);
    int page_count = (int)pages.size();
    if (page_count < 1) page_count = 1;

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    for (int page = 0; page < page_count; ++page) {
        int page_num = page + 1;
        SkCanvas* canvas = pdf_doc->beginPage((SkScalar)pdf_page_width, (SkScalar)pdf_page_height);
        if (!canvas) continue;
        // P5: with an @page size the MediaBox is in pt; scale the px layout to pt.
        if (page_rule.has_size) canvas->scale(kPtPerPx, kPtPerPx);

        if (options.backgroundColor != 0) {
            SkPaint paint;
            paint.setColor(options.backgroundColor);
            canvas->drawRect(SkRect::MakeWH((SkScalar)page_width, (SkScalar)page_height), paint);
        }

        // Header / footer: the document is cached per distinct template HTML, so a
        // template without page-number placeholders is laid out once and only re-drawn.
        if (!options.pdfHeader.empty()) {
            std::string headerHtml = replace_template_vars(options.pdfHeader, page_num, page_count);
            canvas->save();
            canvas->translate((SkScalar)margin_left, 0);
            header_cache.draw(headerHtml, content_width, margin_top, canvas, context, css.c_str(),
                              user_css, media_type);
            canvas->restore();
        }

        if (!options.pdfFooter.empty()) {
            std::string footerHtml = replace_template_vars(options.pdfFooter, page_num, page_count);
            canvas->save();
            canvas->translate((SkScalar)margin_left, (SkScalar)(page_height - footer_band));
            footer_cache.draw(footerHtml, content_width, footer_band, canvas, context, css.c_str(),
                              user_css, media_type);
            canvas->restore();
        }

        // Content slice: the page shift is applied through the draw offset (so fixed elements,
        // which ignore it, stay at their viewport position); the canvas clip bounds the page.
        // The clip height is the distance to the next cut (a fragmentation-shortened page must
        // not paint content that starts the following page), capped at the page content area.
        // P4: a repeated header reserves the top band of a continuation page. Only the table
        // whose header repeats is offset down by the header height (its remaining rows must
        // clear the re-painted header); the rest of the slice keeps its document position, so
        // non-table content on the same page is not displaced.
        const int page_offset = (page < (int)pages.size()) ? pages[page].offset : 0;
        const int header_top = (page < (int)pages.size()) ? pages[page].header_top : -1;
        const int header_height = (page < (int)pages.size()) ? pages[page].header_height : 0;
        const int table_bottom = (page < (int)pages.size()) ? pages[page].table_bottom : INT_MAX;

        int avail = content_area_height - header_height;
        if (avail < 1) avail = 1;
        int slice_height = avail;
        if (page + 1 < (int)pages.size()) slice_height = pages[page + 1].offset - page_offset;
        if (slice_height < 1) slice_height = 1;
        if (slice_height > avail) slice_height = avail;

        // Draw one clip band of the document with a page offset. The bands partition the page
        // (a 2px overlap at the table's closing border aside), so no pixel is painted twice —
        // fixed elements included: they land in the band that covers their viewport position.
        //
        // `cull` hands litehtml the band as its draw clip, so it can skip backgrounds /
        // borders / text and whole subtrees outside it instead of recording the full document
        // for every page. The canvas clip below stays authoritative (litehtml's clip only
        // culls; it never replaces the canvas clip), so the band is padded: a box or an image
        // background that straddles the band edge (the 2px table/after overlap, anti-aliased
        // edges) is still drawn and the neighbouring bands stay seam-free.
        constexpr int kCullPad = 2;
        auto draw_band = [&](int top, int bottom, int doc_offset, bool cull) {
            if (bottom <= top) return;
            canvas->save();
            canvas->translate((SkScalar)margin_left, (SkScalar)margin_top);
            canvas->clipRect(
                SkRect::MakeXYWH(0, (SkScalar)top, (SkScalar)content_width, (SkScalar)(bottom - top)));
            container.reset();
            container.set_canvas(canvas);
            container.set_height(content_area_height);
            container.set_tagging(false);
            litehtml::position clip(-kCullPad, (litehtml::pixel_t)(top - kCullPad),
                                    content_width + 2 * kCullPad,
                                    (bottom - top) + 2 * kCullPad);
            doc->draw(0, 0, -(litehtml::pixel_t)doc_offset, cull ? &clip : nullptr);
            container.flush();
            canvas->restore();
        };

        // box-decoration-break: clone — paint complete boxes for the fragments on this page.
        // A split clone fragment is re-painted per band, so those pages keep the full
        // traversal (the fragment bands are not cut by the page clip).
        doc->clear_fragment_bands();
        bool clone_fragmented = false;
        for (const CloneBox& b : clone_boxes) {
            const int slice_top = page_offset;
            const int slice_bottom = page_offset + slice_height;
            if (b.bottom <= slice_top || b.top >= slice_bottom) continue;
            const int band_top = std::max(0, slice_top - b.top);
            const int band_bottom = std::min(b.bottom - b.top, slice_bottom - b.top);
            if (band_top == 0 && band_bottom == b.bottom - b.top) continue;  // not fragmented
            doc->set_fragment_band(b.el, (litehtml::pixel_t)band_top, (litehtml::pixel_t)band_bottom);
            clone_fragmented = true;
        }
        // A band that ends past the document box must not be handed to litehtml as its clip:
        // for the root element the clip also bounds the (body-propagated) document background,
        // so a partially filled last page would paint background where the full traversal
        // leaves it empty. That page keeps the full traversal (one band only).
        const bool cull = !clone_fragmented && page_offset + slice_height <= doc_height;

        if (header_height > 0 && table_bottom < INT_MAX) {
            const int slice_end = page_offset + slice_height;
            const int table_end_doc = std::min(slice_end, table_bottom);
            const int table_end_rel = table_end_doc - page_offset;
            // Content that follows the table on this page is drawn at its own position, so the
            // offset table band stops where it starts (otherwise the two bands would overlap).
            // Only real flow content counts here: a trailing body margin after the table must
            // not cut the table's last row.
            auto content_starts_in = [&](int from, int to) {
                for (const auto& u : break_units)
                    if (u.top >= from && u.top < to) return true;
                for (const auto& g : line_groups)
                    for (int top : g.tops)
                        if (top >= from && top < to) return true;
                for (const auto& f : float_boxes)
                    if (f.top >= from && f.top < to) return true;
                return false;
            };
            const bool has_after =
                table_end_doc < slice_end && content_starts_in(table_bottom, slice_end);
            // A small overlap keeps the table's closing border (drawn just above its bottom
            // edge, i.e. in the following band) from being cut away.
            int table_band_bottom = table_end_rel + header_height;
            int after_band_top = table_end_rel;
            if (has_after) {
                table_band_bottom = table_end_rel;
                after_band_top = std::max(0, table_end_rel - 2);
            }
            if (table_band_bottom > slice_height + header_height)
                table_band_bottom = slice_height + header_height;

            // The continuing table: same document slice, shifted down by the header height.
            draw_band(header_height, table_band_bottom, page_offset - header_height, cull);
            // The rest of the slice (content after the table): unshifted document position.
            draw_band(after_band_top, slice_height, page_offset, cull);
        } else if (header_height > 0) {
            // No table extent recorded (defensive): keep the historical whole-slice shift.
            draw_band(header_height, header_height + slice_height, page_offset - header_height,
                      cull);
        } else {
            draw_band(0, slice_height, page_offset, cull);
        }
        doc->clear_fragment_bands();

        // P4: repeated table header. Re-paint the document clipped to the header band
        // (its document-space rect) at the top of the page, so the thead appears on
        // every continuation page. The repaint band is not culled: it re-paints a
        // document region that is not the page slice (header_top), so a page-relative
        // cull would be the wrong test.
        if (header_height > 0 && header_top >= 0) draw_band(0, header_height, header_top, false);

        pdf_doc->endPage();
    }

    pdf_doc->close();

    return stream.detachAsData();
}
