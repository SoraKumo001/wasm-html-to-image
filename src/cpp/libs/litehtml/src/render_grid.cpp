#include <functional>
#include <sstream>
#include <map>
#include <cmath>
#include <algorithm>
#include "html.h"
#include "render_grid.h"
#include "render_inline.h"
#include "html_tag.h"
#include "document.h"
#include "el_text.h"
#include "el_space.h"
#include "el_div.h"
#include "document_container.h"

namespace litehtml
{

std::shared_ptr<render_item> render_item_grid::init()
{
    if (m_initialized) return shared_from_this();
    m_initialized = true;
    src_el()->add_render(shared_from_this());

    int column_count = src_el()->css().get_column_count();
    // Width-driven multicol (`column-width`, with or without `column-count`):
    // the track count needs the available inline size, so the grouping into N
    // column boxes is (re)done in calculate_grid_layout(). init() only splits
    // the flowable content into words here.
    const bool has_col_width = !src_el()->css().get_column_width().is_predefined();
    const bool flow_split = column_count > 1 || (column_count <= 0 && has_col_width);
    if (column_count <= 0) column_count = 1;

    std::vector<std::shared_ptr<render_item>> items;
    decltype(m_children) current_inlines;

    // CSS columns break between the blocks inside a list, but this emulation only distributes
    // direct children. A list container (ol/ul/dl) holding all items would stay in one column, so
    // its items are hoisted into the flow instead. Each item gets an anonymous wrapper carrying
    // the container's left indent, so list markers keep their place; numbering comes from the DOM
    // parent and is unaffected.
    auto hoist_list_items = [&](const std::shared_ptr<render_item>& container,
                                std::vector<std::shared_ptr<render_item>>& out) -> bool
    {
        const char* tag = container->src_el()->get_tagName();
        if (!tag || !(!strcmp(tag, "ol") || !strcmp(tag, "ul") || !strcmp(tag, "dl"))) return false;
        if (container->children().size() < 2) return false;
        const auto& css = container->src_el()->css();
        auto doc = src_el()->get_document();
        pixel_t indent = doc->to_pixels(css.get_padding().left, css.get_font_metrics(), 0) +
                         doc->to_pixels(css.get_margins().left, css.get_font_metrics(), 0);
        for (const auto& child : container->children())
        {
            auto anon_el = std::make_shared<el_div>(doc);
            anon_el->parent(src_el());
            string style = "display: block; padding-left: " + std::to_string((int)indent) + "px";
            anon_el->set_attr("style", style.c_str());
            anon_el->compute_styles(false);
            auto anon_ri = std::make_shared<render_item_block>(anon_el);
            anon_ri->add_child(child);
            child->parent(anon_ri);
            out.push_back(anon_ri->init());
        }
        return true;
    };

    auto flush_inlines = [&]()
    {
        if(!current_inlines.empty())
        {
            if (flow_split)
            {
                // Multi-column flow simulation: split text into flowable words
                for (const auto& inl : current_inlines)
                {
                    if (inl->src_el()->is_text())
                    {
                        string text;
                        inl->src_el()->get_text(text);
                        std::vector<string> words = split_string(text, " \t\r\n", "", "");
                        for (const auto& word : words)
                        {
                            if (word.empty()) continue;
                            auto t_el = std::make_shared<el_text>((word + " ").c_str(), src_el()->get_document());
                            t_el->parent(src_el());
                            t_el->compute_styles(false);
                            auto t_ri = std::make_shared<render_item_inline>(t_el);
                            items.push_back(t_ri->init());
                        }
                    }
                    else
                    {
                        items.push_back(inl->init());
                    }
                }
            }
            else
            {
                // Normal Grid: wrap inlines in a single anonymous block
                auto anon_el = std::make_shared<el_anonymous>(src_el()->get_document());
                anon_el->parent(src_el());
                anon_el->compute_styles(false);
                auto anon_ri = std::make_shared<render_item_block>(anon_el);
                for(const auto& inl : current_inlines)
                {
                    anon_ri->add_child(inl);
                    inl->parent(anon_ri);
                }
                items.push_back(anon_ri->init());
            }
            current_inlines.clear();
        }
    };

    for (const auto& el : m_children)
    {
        if (el->src_el()->css().get_display() == display_inline_text || el->src_el()->is_text())
        {
            // A run of only white space generates no grid item, whatever white-space says
            // (code blocks keep a newline between their line spans).
            string run;
            el->src_el()->get_text(run);
            const bool blank = !run.empty() && run.find_first_not_of(" \t\r\n\f") == string::npos;
            // White space between the words of a run is part of it ("Hello world" is split into
            // word, space, word); only white space that would start a run is dropped.
            if ((!el->src_el()->is_white_space() && !blank) || !current_inlines.empty())
            {
                current_inlines.push_back(el);
            }
        }
        else
        {
            flush_inlines();
            el->parent(shared_from_this());
            auto inited = el->init();
            if (flow_split && hoist_list_items(inited, items)) continue;
            items.push_back(inited);
        }
    }
    flush_inlines();

    if (!items.empty() && flow_split)
    {
        if (column_count > 1 && !has_col_width)
        {
            // Count-only: the track count is already known, group right away.
            auto columns = group_into_columns(std::move(items), column_count);
            children().clear();
            for (auto& col : columns)
            {
                children().push_back(col->init());
            }
            m_multicol_grouped = column_count;
        }
        else
        {
            // Width-driven (with or without count): keep the flowable words
            // flat; calculate_grid_layout() groups them once the available
            // inline size is known.
            children().clear();
            for (auto& item : items)
            {
                item->parent(shared_from_this());
                children().push_back(item);
            }
        }
    }
    else
    {
        children().clear();
        for (const auto& item : items)
        {
            // The anonymous block wrapping a run of text has no parent yet (element items got one in
            // the loop above); without it the text of a grid that holds nothing else is never drawn.
            item->parent(shared_from_this());
            children().push_back(item);
        }
    }

    return shared_from_this();
}

std::vector<std::shared_ptr<render_item>> render_item_grid::group_into_columns(
    std::vector<std::shared_ptr<render_item>> items, int column_count)
{
    // 2. Group items into column containers to simulate flow
    std::vector<std::shared_ptr<render_item>> columns;
    for (int i = 0; i < column_count; i++)
    {
        auto anon_el = std::make_shared<el_div>(src_el()->get_document());
        anon_el->parent(src_el());
        string style = "display: block; width: 100%; grid-column-start: " + std::to_string(i + 1);
        anon_el->set_attr("style", style.c_str());
        anon_el->compute_styles(false);

        auto anon_ri = std::make_shared<render_item_block>(anon_el);
        anon_ri->parent(shared_from_this());
        columns.push_back(anon_ri);
    }

    // Balance the columns like a multicol container does: items are not measured yet, so an
    // item weighs as many lines as it has text runs. The contiguous split with the smallest
    // tallest column wins (binary search on the column cap, greedy fill).
    std::vector<int> weight(items.size(), 1);
    std::function<int(const std::shared_ptr<render_item>&)> count_text =
        [&](const std::shared_ptr<render_item>& ri) -> int
    {
        int n = 0;
        for (const auto& ch : ri->children())
        {
            if (ch->src_el()->is_text()) n += 1;
            else n += count_text(ch);
        }
        return n;
    };
    int total = 0, biggest = 1;
    for (size_t i = 0; i < items.size(); i++)
    {
        weight[i] = std::max(1, count_text(items[i]));
        total += weight[i];
        biggest = std::max(biggest, weight[i]);
    }
    auto columns_needed = [&](int cap)
    {
        int cols = 1, cur = 0;
        for (int w : weight)
        {
            if (cur + w > cap) { cols++; cur = 0; }
            cur += w;
        }
        return cols;
    };
    int lo = biggest, hi = total;
    while (lo < hi)
    {
        int mid = (lo + hi) / 2;
        if (columns_needed(mid) <= column_count) hi = mid; else lo = mid + 1;
    }
    size_t col_idx = 0;
    int cur = 0;
    for (size_t i = 0; i < items.size(); i++)
    {
        if (cur + weight[i] > lo && col_idx + 1 < (size_t)column_count && cur > 0)
        {
            col_idx++;
            cur = 0;
        }
        cur += weight[i];
        columns[col_idx]->add_child(items[i]);
        items[i]->parent(columns[col_idx]);
    }
    return columns;
}

namespace
{
// A <number> written as math: calc(), min(), max(), clamp() over plain numbers, nested freely
// (`grid-column: span min(var(--cols), var(--span))`). Anything else yields false.
bool eval_number_math(const css_token& tok, double& out);

double eval_number_expr(const css_token_vector& t, bool& ok);

double eval_number_primary(const css_token_vector& t, size_t& i, bool& ok)
{
    while (i < t.size() && t[i].type == WHITESPACE) i++;
    if (i >= t.size()) { ok = false; return 0; }
    const auto& tok = t[i++];
    double v = 0;
    if (tok.type == NUMBER) return tok.n.number;
    if (tok.type == ROUND_BLOCK) return eval_number_expr(tok.value, ok);
    if (tok.type == CV_FUNCTION && eval_number_math(tok, v)) return v;
    ok = false;
    return 0;
}

double eval_number_term(const css_token_vector& t, size_t& i, bool& ok)
{
    double v = eval_number_primary(t, i, ok);
    for (;;)
    {
        while (i < t.size() && t[i].type == WHITESPACE) i++;
        if (i >= t.size() || (t[i].type != '*' && t[i].type != '/')) return v;
        const bool mul = t[i++].type == '*';
        const double r = eval_number_primary(t, i, ok);
        if (mul) v *= r;
        else if (r != 0) v /= r;
        else ok = false;
    }
}

double eval_number_expr(const css_token_vector& t, bool& ok)
{
    size_t i = 0;
    double v = eval_number_term(t, i, ok);
    for (;;)
    {
        while (i < t.size() && t[i].type == WHITESPACE) i++;
        if (i >= t.size() || (t[i].type != '+' && t[i].type != '-')) return v;
        const bool add = t[i++].type == '+';
        const double r = eval_number_term(t, i, ok);
        v = add ? v + r : v - r;
    }
}

bool eval_number_math(const css_token& tok, double& out)
{
    const string name = lowcase(tok.name);
    if (name != "calc" && name != "min" && name != "max" && name != "clamp") return false;
    std::vector<css_token_vector> args(1);
    for (const auto& t : tok.value)
    {
        if (t.type == ',') args.emplace_back();
        else args.back().push_back(t);
    }
    std::vector<double> v;
    bool ok = true;
    for (const auto& a : args) v.push_back(eval_number_expr(a, ok));
    if (!ok || v.empty()) return false;
    if (name == "calc") { out = v[0]; return v.size() == 1; }
    if (name == "min") { out = *std::min_element(v.begin(), v.end()); return true; }
    if (name == "max") { out = *std::max_element(v.begin(), v.end()); return true; }
    if (v.size() != 3) return false;  // clamp(min, val, max)
    out = std::max(v[0], std::min(v[1], v[2]));
    return true;
}

struct grid_line
{
    int index = 0;
    int span = 1;
    bool is_span = false;
    string name;  // <custom-ident> naming a line or an area (resolved by the grid layout)

    void parse(const css_token_vector& tokens)
    {
        if (tokens.empty()) return;
        
        for (int i = 0; i < (int)tokens.size(); i++)
        {
            const auto& tok = tokens[i];
            if (tok.type == IDENT && tok.ident() == "span")
            {
                is_span = true;
            }
            else if (tok.type == NUMBER)
            {
                if (is_span) span = (int)tok.n.number;
                else index = (int)tok.n.number;
            }
            else if (tok.type == CV_FUNCTION)
            {
                double v = 0;
                if (eval_number_math(tok, v))
                {
                    if (is_span) span = std::max(1, (int)std::lround(v));
                    else index = (int)std::lround(v);
                }
            }
            else if (tok.type == IDENT && !is_span)
            {
                string id = lowcase(tok.ident());
                if (id != "auto") name = tok.ident();
            }
        }
    }
};

// Named grid lines ([name] groups in grid-template-columns/rows) and areas
// (grid-template-areas), resolved to 1-based line numbers.
struct grid_names
{
    std::map<string, int> lines;  // name -> first 1-based line number

    // Walks the raw template tokens; every track-size token advances the line counter.
    void collect(const css_token_vector& tokens, int& line)
    {
        for (const auto& tok : tokens)
        {
            if (tok.type == WHITESPACE) continue;
            if (tok.type == SQUARE_BLOCK)
            {
                for (const auto& t : tok.value)
                {
                    if (t.type == IDENT && !lines.count(t.ident())) lines[t.ident()] = line;
                }
            }
            else if (tok.type == CV_FUNCTION && lowcase(tok.name) == "repeat")
            {
                int count = 1;
                bool seen_comma = false;
                css_token_vector inner;
                for (const auto& t : tok.value)
                {
                    if (t.type == ',') { seen_comma = true; continue; }
                    if (!seen_comma)
                    {
                        if (t.type == NUMBER) count = std::max(1, (int)t.n.number);
                    }
                    else
                    {
                        inner.push_back(t);
                    }
                }
                for (int i = 0; i < count; i++) collect(inner, line);
            }
            else
            {
                line++;
            }
        }
    }
};

struct grid_area_rect
{
    int row_start, row_end, col_start, col_end;  // 0-based, end exclusive
};

// grid-template-areas: one string per row, cells separated by whitespace, '.' for an empty cell.
void parse_grid_areas(const css_token_vector& tokens, std::map<string, grid_area_rect>& areas, int& rows, int& cols)
{
    rows = 0;
    cols = 0;
    for (const auto& tok : tokens)
    {
        if (tok.type != STRING) continue;
        int c = 0;
        std::istringstream iss(tok.str);
        string cell;
        while (iss >> cell)
        {
            if (cell.find_first_not_of('.') != string::npos)
            {
                auto it = areas.find(cell);
                if (it == areas.end())
                {
                    areas[cell] = { rows, rows + 1, c, c + 1 };
                }
                else
                {
                    it->second.row_end = std::max(it->second.row_end, rows + 1);
                    it->second.col_end = std::max(it->second.col_end, c + 1);
                }
            }
            c++;
        }
        cols = std::max(cols, c);
        rows++;
    }
}
}

void litehtml::render_item_grid::calculate_grid_layout(const containing_block_context& self_size, formatting_context* fmt_ctx)
{
    m_grid_layout.clear();

    // Grid columns run along the inline axis and rows along the block axis. In vertical writing
    // that transposes the physical axes, so every "width" below is the inline size (physical
    // height) and every "height" the block size (physical width).
    const bool vert = css().get_writing_mode() != writing_mode_horizontal_tb;
    const containing_block_context::typed_pixel& render_inline = vert ? self_size.render_height : self_size.render_width;
    const containing_block_context::typed_pixel& render_block = vert ? self_size.render_width : self_size.render_height;

    const auto& columns_template_raw = css().get_grid_template_columns();
    const auto& rows_template_raw = css().get_grid_template_rows();

    m_grid_layout.column_gap = css().get_column_gap().calc_percent(render_inline);
    m_grid_layout.row_gap = css().get_row_gap().calc_percent(render_block);

    // Multicol emulation: resolve the effective track count. `column-width`
    // derives it from the available inline size (N fr tracks fill it exactly);
    // with both set, the count caps the width-derived number.
    const int specified_count = src_el()->css().get_column_count();
    const bool has_col_width = !src_el()->css().get_column_width().is_predefined();
    const bool is_multicol = specified_count > 0 || has_col_width;
    int multicol_n = specified_count > 0 ? specified_count : 1;
    if (is_multicol)
    {
        // Note: render_inline carries the resolved pixel value even when its
        // type is auto (e.g. block boxes in an auto-width container), so the
        // value alone decides whether the track count can be derived.
        const bool avail_known = render_inline.value > 0;
        if (has_col_width && avail_known)
        {
            pixel_t col_w = src_el()->css().get_column_width().calc_percent(render_inline);
            pixel_t denom = col_w + m_grid_layout.column_gap;
            if (denom > 0)
            {
                int nmax = (render_inline + m_grid_layout.column_gap) / denom;
                if (nmax < 1) nmax = 1;
                multicol_n = specified_count > 0 ? std::min(specified_count, nmax) : nmax;
            }
        }
        if (m_multicol_grouped != multicol_n)
        {
            // (Re)group the flowable content into the resolved number of
            // column boxes. Previously grouped children are unwrapped one
            // level back to their flowable items first.
            std::vector<std::shared_ptr<render_item>> leaves;
            if (m_multicol_grouped > 0)
            {
                for (const auto& c : children())
                {
                    for (const auto& g : c->children()) leaves.push_back(g);
                }
            }
            else
            {
                for (const auto& c : children()) leaves.push_back(c);
            }
            if (!leaves.empty())
            {
                auto columns = group_into_columns(std::move(leaves), multicol_n);
                children().clear();
                for (auto& col : columns) children().push_back(col->init());
                m_multicol_grouped = multicol_n;
            }
        }
    }

    // Expand column template
    length_vector columns_template;
    if (is_multicol)
    {
        for (int i = 0; i < multicol_n; i++)
        {
            columns_template.push_back(css_length(1, css_units_fr));
        }
    }
    else
    {
    for (const auto& len : columns_template_raw)
    {
        if (len.is_calc() && (len.get_op() == css_length::op_repeat_auto_fit || len.get_op() == css_length::op_repeat_auto_fill))
        {
            pixel_t total_min = 0;
            for (const auto& op : len.get_operands())
            {
                if (op.is_calc() && op.get_op() == css_length::op_minmax)
                    total_min += op.get_operands()[0].calc_percent(render_inline);
                else
                    total_min += op.calc_percent(render_inline);
            }
            int repeats = 1;
            if (total_min + m_grid_layout.column_gap > 0 && render_inline > 0)
            {
                repeats = (render_inline + m_grid_layout.column_gap) / (total_min + m_grid_layout.column_gap);
                if (repeats < 1) repeats = 1;
            }
            for (int i = 0; i < repeats; i++)
            {
                for (const auto& op : len.get_operands()) columns_template.push_back(op);
            }
        }
        else
        {
            columns_template.push_back(len);
        }
    }
    }

    // Expand row template
    length_vector rows_template;
    for (const auto& len : rows_template_raw)
    {
        if (len.is_calc() && (len.get_op() == css_length::op_repeat_auto_fit || len.get_op() == css_length::op_repeat_auto_fill))
        {
            // For now, rows don't auto-expand based on height as easily as columns, 
            // but we can at least support fixed repeats or just one repeat.
            for (const auto& op : len.get_operands()) rows_template.push_back(op);
        }
        else
        {
            rows_template.push_back(len);
        }
    }

    // Named lines and grid-template-areas
    grid_names col_names, row_names;
    {
        int line = 1;
        col_names.collect(css().get_grid_columns_tokens(), line);
        line = 1;
        row_names.collect(css().get_grid_rows_tokens(), line);
    }
    std::map<string, grid_area_rect> areas;
    int area_rows = 0, area_cols = 0;
    parse_grid_areas(css().get_grid_template_areas(), areas, area_rows, area_cols);
    for (const auto& a : areas)
    {
        // an area X implies the lines X-start / X-end on both axes
        col_names.lines.emplace(a.first + "-start", a.second.col_start + 1);
        col_names.lines.emplace(a.first + "-end", a.second.col_end + 1);
        row_names.lines.emplace(a.first + "-start", a.second.row_start + 1);
        row_names.lines.emplace(a.first + "-end", a.second.row_end + 1);
    }
    // The areas grid defines at least that many (implicit, auto-sized) tracks.
    if (!is_multicol)
    {
        while ((int)columns_template.size() < area_cols) columns_template.push_back(css_length::predef_value(0));
    }
    while ((int)rows_template.size() < area_rows) rows_template.push_back(css_length::predef_value(0));
    auto resolve_named = [&](grid_line& gl, const grid_names& names, bool is_end) {
        if (gl.name.empty() || gl.index != 0 || gl.is_span) return;
        auto it = names.lines.find(gl.name);
        if (it == names.lines.end()) it = names.lines.find(gl.name + (is_end ? "-end" : "-start"));
        if (it != names.lines.end()) gl.index = it->second;
    };

    // Flow axis for auto-placement. Row flow wraps at the column count; column
    // flow fills a column top-to-bottom, wraps at the row count and grows the
    // implicit columns instead.
    const grid_auto_flow auto_flow = css().get_grid_auto_flow();
    const bool column_flow = auto_flow == grid_auto_flow_column ||
                             auto_flow == grid_auto_flow_column_dense;
    const bool dense = auto_flow == grid_auto_flow_row_dense ||
                       auto_flow == grid_auto_flow_column_dense;

    // Rows in the column-flow grid: the explicit count, or the largest definite
    // row / row span, and at least one. Column flow never creates implicit rows.
    int flow_rows = std::max((int)rows_template.size(), 1);
    if (column_flow)
    {
        for (const auto& el : m_children)
        {
            auto pos = el->src_el()->css().get_position();
            if (pos == element_position_absolute || pos == element_position_fixed) continue;
            grid_line rs, re;
            rs.parse(el->src_el()->css().get_grid_row_start());
            re.parse(el->src_el()->css().get_grid_row_end());
            resolve_named(rs, row_names, false);
            resolve_named(re, row_names, true);
            int start = -1;
            int span = 1;
            if (rs.is_span) span = rs.span;
            else if (rs.index > 0) start = rs.index - 1;
            if (re.is_span) span = re.span;
            else if (re.index > rs.index && rs.index > 0) span = re.index - rs.index;
            flow_rows = std::max(flow_rows, start >= 0 ? start + span : span);
        }
    }

    // Number of explicit tracks; implicit tracks added below continue to cycle
    // grid-auto-columns from this offset.
    const int explicit_col_count = (int)columns_template.size();

    // grid-auto-columns: explicit placements past the template create implicit
    // columns. Extend the track list now so sizing/placement see them; otherwise
    // those items collapse into column 0 and the offsets are read out of bounds.
    if (!is_multicol)
    {
        const auto& auto_cols = css().get_grid_auto_columns();
        const int template_cols = (int)columns_template.size();
        int required_cols = template_cols;
        for (const auto& el : m_children)
        {
            if (el->src_el()->css().get_position() == element_position_absolute ||
                el->src_el()->css().get_position() == element_position_fixed)
                continue;
            grid_line cs, ce;
            cs.parse(el->src_el()->css().get_grid_column_start());
            ce.parse(el->src_el()->css().get_grid_column_end());
            resolve_named(cs, col_names, false);
            resolve_named(ce, col_names, true);
            int start = -1;
            int span = 1;
            if (cs.is_span) span = cs.span;
            else if (cs.index > 0) start = cs.index - 1;
            if (ce.is_span) span = ce.span;
            else if (ce.index > cs.index && cs.index > 0) span = ce.index - cs.index;
            if (start >= 0) required_cols = std::max(required_cols, start + span);
        }
        for (int i = template_cols; i < required_cols; i++)
        {
            if (auto_cols.empty())
                columns_template.push_back(css_length::predef_value(0));
            else
                columns_template.push_back(auto_cols[(i - template_cols) % auto_cols.size()]);
        }
    }

    int num_columns = (int)columns_template.size();
    if (num_columns == 0) num_columns = 1;

    // Column sizing is deferred until after placement: column flow can create
    // implicit columns while it auto-places items.

    // Determine placements and number of rows
    int max_row = 0;

    // Occupancy map: row -> vector<bool> (cols)
    vector<vector<bool>> occupied;
    auto is_occupied = [&](int r, int c) -> bool {
        if (r < (int)occupied.size()) {
            if (c < (int)occupied[r].size()) return (bool)occupied[r][c];
        }
        return false;
    };
    auto mark_occupied = [&](int r, int c, int rs, int cs) {
        // Column flow grows the implicit grid sideways, so the map width follows
        // the placed item rather than the initial template count.
        if (c + cs > num_columns) num_columns = c + cs;
        if (r + rs > (int)occupied.size()) occupied.resize(r + rs, vector<bool>(num_columns, false));
        for (int i = r; i < r + rs; i++) {
            if ((int)occupied[i].size() < num_columns) occupied[i].resize(num_columns, false);
            for (int j = c; j < c + cs; j++) {
                occupied[i][j] = true;
            }
        }
    };

    int curr_row = 0;
    int curr_col = 0;

    // Auto-placement runs in order-modified document order: `order` moves a grid item to its
    // place in the flow just like it does for flex items, while items sharing an order keep
    // their DOM order. Paint order (draw_children) still follows the DOM.
    std::vector<std::shared_ptr<render_item>> placement_items;
    placement_items.reserve(m_children.size());
    bool order_sort_required = false;
    bool prev_item_order_set = false;
    int prev_item_order = 0;
    for (const auto& el : m_children)
    {
        if (el->src_el()->css().get_position() == element_position_absolute || el->src_el()->css().get_position() == element_position_fixed)
            continue;
        const int item_order = el->src_el()->css().get_order();
        if (!prev_item_order_set)
        {
            prev_item_order = item_order;
            prev_item_order_set = true;
        }
        else if (!order_sort_required && item_order != prev_item_order)
        {
            order_sort_required = true;
        }
        placement_items.push_back(el);
    }
    if (order_sort_required)
    {
        std::stable_sort(placement_items.begin(), placement_items.end(),
                         [](const std::shared_ptr<render_item>& item1, const std::shared_ptr<render_item>& item2)
                         { return item1->src_el()->css().get_order() < item2->src_el()->css().get_order(); });
    }

    for (const auto& el : placement_items)
    {
        grid_line cs, ce, rs, re;
        cs.parse(el->src_el()->css().get_grid_column_start());
        ce.parse(el->src_el()->css().get_grid_column_end());
        rs.parse(el->src_el()->css().get_grid_row_start());
        re.parse(el->src_el()->css().get_grid_row_end());
        resolve_named(cs, col_names, false);
        resolve_named(ce, col_names, true);
        resolve_named(rs, row_names, false);
        resolve_named(re, row_names, true);

        // Negative line numbers count from the end of the explicit grid (-1 is the last line).
        if (!cs.is_span && cs.index < 0) cs.index = std::max(1, num_columns + 2 + cs.index);
        if (!ce.is_span && ce.index < 0) ce.index = std::max(1, num_columns + 2 + ce.index);

        int item_col_start = 0;
        int item_col_span = 1;
        int item_row_start = 0;
        int item_row_span = 1;

        // Resolve spans and fixed positions
        if (cs.is_span)
        {
            item_col_span = cs.span;
        }
        else if (cs.index > 0)
        {
            item_col_start = cs.index - 1;
        }

        if (ce.is_span)
        {
            item_col_span = ce.span;
        }
        else if (ce.index > cs.index && cs.index > 0)
        {
            item_col_span = ce.index - cs.index;
        }

        if (rs.is_span)
        {
            item_row_span = rs.span;
        }
        else if (rs.index > 0)
        {
            item_row_start = rs.index - 1;
        }

        if (re.is_span)
        {
            item_row_span = re.span;
        }
        else if (re.index > rs.index && rs.index > 0)
        {
            item_row_span = re.index - rs.index;
        }

        // Auto placement
        if (column_flow)
        {
            if (cs.index > 0 && rs.index <= 0)
            {
                // Definite column, auto row: the item is locked to its column in either flow.
                if (item_col_start < curr_col) curr_row++;
                curr_col = item_col_start;
                for (;;)
                {
                    bool conflict = false;
                    for (int r = curr_row; r < curr_row + item_row_span && !conflict; r++)
                        for (int c = item_col_start; c < item_col_start + item_col_span; c++)
                            if (is_occupied(r, c)) { conflict = true; break; }
                    if (!conflict) break;
                    curr_row++;
                }
                item_row_start = curr_row;
            }
            else if (rs.index > 0 && cs.index <= 0)
            {
                // Definite row, auto column: moves to the next column when the row is
                // behind the cursor, then right until the cells are free.
                if (item_row_start < curr_row) curr_col++;
                curr_row = item_row_start;
                for (;;)
                {
                    bool conflict = false;
                    for (int r = item_row_start; r < item_row_start + item_row_span && !conflict; r++)
                        for (int c = curr_col; c < curr_col + item_col_span; c++)
                            if (is_occupied(r, c)) { conflict = true; break; }
                    if (!conflict) break;
                    curr_col++;
                }
                item_col_start = curr_col;
            }
            else if (rs.index <= 0)
            {
                // Both axes auto: fill the current column top-to-bottom, then wrap to
                // the next (implicit) column. Dense restarts the search per item.
                if (dense) { curr_row = 0; curr_col = 0; }
                bool found = false;
                while (!found)
                {
                    if (curr_row + item_row_span > flow_rows)
                    {
                        curr_row = 0;
                        curr_col++;
                    }

                    bool conflict = false;
                    for (int r = curr_row; r < curr_row + item_row_span; r++)
                    {
                        for (int c = curr_col; c < curr_col + item_col_span; c++)
                        {
                            if (is_occupied(r, c))
                            {
                                conflict = true;
                                break;
                            }
                        }
                        if (conflict) break;
                    }

                    if (!conflict)
                    {
                        item_col_start = curr_col;
                        item_row_start = curr_row;
                        found = true;
                        curr_row += item_row_span;
                    }
                    else
                    {
                        curr_row++;
                        if (curr_row >= flow_rows)
                        {
                            curr_row = 0;
                            curr_col++;
                        }
                    }
                }
            }
        }
        else if (cs.index <= 0 && !cs.is_span)
        {
            if (dense) { curr_row = 0; curr_col = 0; }
            bool found = false;
            while (!found)
            {
                if (curr_col + item_col_span > num_columns)
                {
                    curr_col = 0;
                    curr_row++;
                }

                bool conflict = false;
                for (int r = curr_row; r < curr_row + item_row_span; r++)
                {
                    for (int c = curr_col; c < curr_col + item_col_span; c++)
                    {
                        if (is_occupied(r, c))
                        {
                            conflict = true;
                            break;
                        }
                    }
                    if (conflict) break;
                }

                if (!conflict)
                {
                    item_col_start = curr_col;
                    item_row_start = curr_row;
                    found = true;
                    curr_col += item_col_span;
                }
                else
                {
                    curr_col++;
                    if (curr_col >= num_columns)
                    {
                        curr_col = 0;
                        curr_row++;
                    }
                }
            }
        }
        else if (cs.is_span && cs.index <= 0)
        {
            if (dense) { curr_row = 0; curr_col = 0; }
            bool found = false;
            while (!found)
            {
                if (curr_col + item_col_span > num_columns)
                {
                    curr_col = 0;
                    curr_row++;
                }

                bool conflict = false;
                for (int r = curr_row; r < curr_row + item_row_span; r++)
                {
                    for (int c = curr_col; c < curr_col + item_col_span; c++)
                    {
                        if (is_occupied(r, c))
                        {
                            conflict = true;
                            break;
                        }
                    }
                    if (conflict) break;
                }

                if (!conflict)
                {
                    item_col_start = curr_col;
                    item_row_start = curr_row;
                    found = true;
                    curr_col += item_col_span;
                }
                else
                {
                    curr_col++;
                    if (curr_col >= num_columns)
                    {
                        curr_col = 0;
                        curr_row++;
                    }
                }
            }
        }

        else if (cs.index > 0 && rs.index <= 0)
        {
            // Definite column, auto row: sparse packing moves to the next row when the column is
            // behind the cursor, then down until the cells are free.
            if (item_col_start < curr_col) curr_row++;
            curr_col = item_col_start;
            for (;;)
            {
                bool conflict = false;
                for (int r = curr_row; r < curr_row + item_row_span && !conflict; r++)
                    for (int c = item_col_start; c < item_col_start + item_col_span; c++)
                        if (is_occupied(r, c)) { conflict = true; break; }
                if (!conflict) break;
                curr_row++;
            }
            item_row_start = curr_row;
        }

        mark_occupied(item_row_start, item_col_start, item_row_span, item_col_span);
        
        grid_item item;
        item.el = el;
        item.pos = { item_col_start, item_col_start + item_col_span, item_row_start, item_row_start + item_row_span };
        m_grid_layout.items.push_back(item);
        max_row = std::max(max_row, item.pos.row_end);
    }

    // Column flow creates implicit columns while auto-placing. Append their
    // grid-auto-columns sizes before the tracks are measured.
    if (!is_multicol && num_columns > (int)columns_template.size())
    {
        const auto& auto_cols = css().get_grid_auto_columns();
        for (int i = (int)columns_template.size(); i < num_columns; i++)
        {
            if (auto_cols.empty())
                columns_template.push_back(css_length::predef_value(0));
            else
                columns_template.push_back(auto_cols[(i - explicit_col_count) % auto_cols.size()]);
        }
    }

    m_grid_layout.column_widths.assign(num_columns, 0);
    float total_fr = 0;
    pixel_t fixed_width = 0;

    // First pass: Calculate fixed widths and identify fr units
    for (int i = 0; i < num_columns; i++)
    {
        const auto& len = columns_template[i];
        if (len.units() == css_units_fr)
        {
            total_fr += len.val();
        }
        else if (len.is_calc() && len.get_op() == css_length::op_minmax)
        {
            // minmax(min, max)
            const auto& min_len = len.get_operands()[0];
            const auto& max_len = len.get_operands()[1];
            
            m_grid_layout.column_widths[i] = min_len.calc_percent(render_inline);
            fixed_width += m_grid_layout.column_widths[i];

            if (max_len.units() == css_units_fr)
            {
                total_fr += max_len.val();
            }
        }
        else if (!len.is_predefined())
        {
            m_grid_layout.column_widths[i] = len.calc_percent(render_inline);
            fixed_width += m_grid_layout.column_widths[i];
        }
    }

    fixed_width += m_grid_layout.column_gap * (num_columns - 1);

    // minmax(<length>, <length>) tracks are content-independent: they start at their minimum and
    // the free space is handed out to them (before any fr track) up to their maximum
    // ("maximize tracks"). Returns the free space left over.
    auto is_definite_minmax = [&](int i)
    {
        if (i >= (int)columns_template.size()) return false;
        const auto& l = columns_template[i];
        if (!l.is_calc() || l.get_op() != css_length::op_minmax || l.get_operands().size() != 2) return false;
        const auto& mn = l.get_operands()[0];
        const auto& mx = l.get_operands()[1];
        return !mn.is_predefined() && !mx.is_predefined() && mx.units() != css_units_fr;
    };
    auto maximize_definite_minmax = [&](pixel_t free) -> pixel_t
    {
        std::vector<int> active;
        std::vector<pixel_t> mins(num_columns, 0), caps(num_columns, 0);
        for (int i = 0; i < num_columns; i++)
        {
            if (!is_definite_minmax(i)) continue;
            const auto& ops = columns_template[i].get_operands();
            mins[i] = ops[0].calc_percent(render_inline);
            caps[i] = std::max(mins[i], ops[1].calc_percent(render_inline));
            m_grid_layout.column_widths[i] = mins[i];
            active.push_back(i);
        }
        if (free < 0) free = 0;
        while (!active.empty() && free > 0.01f)
        {
            pixel_t share = free / (pixel_t)active.size();
            bool capped = false;
            for (size_t k = 0; k < active.size();)
            {
                int i = active[k];
                pixel_t room = caps[i] - m_grid_layout.column_widths[i];
                if (room <= share)
                {
                    m_grid_layout.column_widths[i] = caps[i];
                    free -= room;
                    active.erase(active.begin() + k);
                    capped = true;
                }
                else k++;
            }
            if (capped) continue;
            for (int i : active) m_grid_layout.column_widths[i] += share;
            free = 0;
        }
        return free;
    };

    // Intrinsic sizing: when the grid's own inline size is indefinite (e.g. a column flex
    // item's cross size measured with size_mode_content), fr tracks are sized from their
    // items' max-content contributions instead of sharing the available width. Without this
    // a width:auto grid never shrinks below the space it is measured in, so an outer
    // shrink-to-fit flex item is forced to the available width by any 1fr track.
    // A floated grid with `width: auto` shrinks to fit whatever mode it was measured in.
    const bool self_shrink = !vert && src_el()->css().get_float() != float_none &&
                             src_el()->css().get_width().is_predefined();
    const bool content_inline =
        ((self_size.size_mode & (containing_block_context::size_mode_content |
                                 containing_block_context::size_mode_min_content)) != 0 &&
         render_inline.type == containing_block_context::cbc_value_type_auto) ||
        self_shrink;
    std::vector<pixel_t> fr_contrib(num_columns, 0);
    std::vector<pixel_t> fr_single(num_columns, 0);  // contributions of single-column items only
    struct span_fr_item { int c0, c1; pixel_t w; };
    std::vector<span_fr_item> span_fr;  // items spanning fr tracks, redone once content tracks are sized
    // Sized under a min-content constraint, the flex fraction is zero (Blink DetermineFreeSpace): an fr
    // track is as wide as its items' min-content contributions, not scaled up to the largest one.
    const bool min_content_constraint = (self_size.size_mode & containing_block_context::size_mode_min_content) != 0;
    if (content_inline && total_fr > 0)
    {
        for (auto& item : m_grid_layout.items)
        {
            containing_block_context cb = self_size;
            // The grid's own exact size describes its box, not the intrinsic size of an item.
            cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
            cb.size_mode |= containing_block_context::size_mode_content;
            if (min_content_constraint) cb.size_mode |= containing_block_context::size_mode_min_content;
            pixel_t measured = item.el->measure(cb, fmt_ctx);
            // measure() already returns the margin-box inline size; inline_size() can still be the
            // larger of the two when the box was measured earlier, so take both into account.
            pixel_t w = std::max((pixel_t)item.el->inline_size(),
                                 measured);

            const int span = item.pos.col_end - item.pos.col_start;
            pixel_t factors = 0;
            for (int c = item.pos.col_start; c < item.pos.col_end && c < num_columns; c++)
            {
                const auto& len = columns_template[c];
                if (len.units() == css_units_fr)
                {
                    factors += len.val();
                }
                else if (len.is_calc() && len.get_op() == css_length::op_minmax &&
                         len.get_operands()[1].units() == css_units_fr)
                {
                    factors += len.get_operands()[1].val();
                }
            }
            if (factors <= 0) continue;

            // A spanning item's contribution covers the gaps between its tracks and the tracks that
            // are not flexible first; the remainder is shared by the spanned fr tracks in proportion
            // to their factor.
            pixel_t inner = w - m_grid_layout.column_gap * (span - 1);
            if (span > 1)
            {
                span_fr.push_back({item.pos.col_start, std::min(item.pos.col_end, num_columns), w});
                for (int c = item.pos.col_start; c < item.pos.col_end && c < num_columns; c++)
                {
                    const auto& l = columns_template[c];
                    const bool flex = l.units() == css_units_fr ||
                        (l.is_calc() && l.get_op() == css_length::op_minmax && l.get_operands()[1].units() == css_units_fr);
                    if (!flex) inner -= m_grid_layout.column_widths[c];
                }
            }
            if (inner < 0) inner = 0;
            for (int c = item.pos.col_start; c < item.pos.col_end && c < num_columns; c++)
            {
                const auto& len = columns_template[c];
                pixel_t factor = 0;
                if (len.units() == css_units_fr)
                {
                    factor = len.val();
                }
                else if (len.is_calc() && len.get_op() == css_length::op_minmax &&
                         len.get_operands()[1].units() == css_units_fr)
                {
                    factor = len.get_operands()[1].val();
                }
                if (factor > 0)
                {
                    fr_contrib[c] = std::max(fr_contrib[c], (pixel_t)(inner * factor / factors));
                    if (span == 1) fr_single[c] = fr_contrib[c];
                }
            }
        }
    }

    // Distribute remaining space to fr columns
    if (!content_inline)
    {
        pixel_t free_width = render_inline - fixed_width;
        if (free_width < 0) free_width = 0;
        maximize_definite_minmax(free_width);
    }
    auto resolve_flex_tracks = [&](pixel_t remaining_width, const std::vector<int>* skip)
    {
        // Flexible tracks (CSS Grid 12.7.1): the leftover space excludes what the flexible tracks
        // themselves hold as a base, so `minmax(40px, 1fr) 1fr` over 600px is 300 + 300, not 320 + 280.
        // A track whose base exceeds its share is frozen at the base and the rest is re-shared.
        std::vector<pixel_t> factor(num_columns, 0), base(num_columns, 0);
        std::vector<bool> active(num_columns, false);
        pixel_t leftover = remaining_width;
        for (int i = 0; i < num_columns; i++)
        {
            if (skip && (*skip)[i]) continue;
            const auto& len = columns_template[i];
            if (len.units() == css_units_fr)
            {
                factor[i] = len.val();
                active[i] = factor[i] > 0;
            }
            else if (len.is_calc() && len.get_op() == css_length::op_minmax && len.get_operands()[1].units() == css_units_fr)
            {
                factor[i] = len.get_operands()[1].val();
                base[i] = m_grid_layout.column_widths[i];
                leftover += base[i];
                active[i] = factor[i] > 0;
            }
        }
        // A plain fr track is minmax(auto, Nfr): it never gets narrower than its items' min-content size.
        for (auto& item : m_grid_layout.items)
        {
            if (item.pos.col_end - item.pos.col_start != 1) continue;
            const int c = item.pos.col_start;
            if (c >= num_columns || !active[c] || columns_template[c].units() != css_units_fr) continue;
            if (item.el->src_el()->css().get_overflow() != overflow_visible) continue;
            // Only an item whose size is set by CSS (a definite width or min-width, not a percentage)
            // gives a reliable floor; a text item's min-content size is left to the share.
            const css_length& iw = item.el->src_el()->css().get_width();
            const css_length& imw = item.el->src_el()->css().get_min_width();
            auto definite = [](const css_length& l) { return !l.is_predefined() && !l.is_calc() && l.units() != css_units_percentage; };
            // An explicit min-width switches the automatic minimum off: it is the floor itself.
            if (!imw.is_predefined())
            {
                if (definite(imw)) base[c] = std::max(base[c], imw.calc_percent(render_inline) + item.el->content_offset_width());
                continue;
            }
            // A nested grid sizes itself from tracks and definite sizes, which measure() gets right.
            const auto idisp = item.el->src_el()->css().get_display();
            const bool nested_grid = idisp == display_grid || idisp == display_inline_grid;
            if (!definite(iw) && !nested_grid) continue;
            containing_block_context cb = self_size;
            cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
            cb.size_mode |= containing_block_context::size_mode_content | containing_block_context::size_mode_min_content;
            base[c] = std::max(base[c], (pixel_t)std::ceil(item.el->measure(cb, fmt_ctx)));
        }
        for (int guard = 0; guard < num_columns + 1; guard++)
        {
            pixel_t sum = 0;
            for (int i = 0; i < num_columns; i++) if (active[i]) sum += factor[i];
            if (sum <= 0) break;
            // (Blink/spec 12.7.1: a flex factor sum below 1 is treated as 1, so 0.25fr 0.25fr leaves space over)
            const pixel_t fr = std::max<pixel_t>(0, leftover) / std::max<pixel_t>(sum, 1);
            bool frozen = false;
            for (int i = 0; i < num_columns; i++)
            {
                if (active[i] && base[i] > fr * factor[i])
                {
                    active[i] = false;
                    m_grid_layout.column_widths[i] = base[i];
                    leftover -= base[i];
                    frozen = true;
                }
            }
            if (frozen) continue;
            for (int i = 0; i < num_columns; i++)
                if (active[i]) m_grid_layout.column_widths[i] = (pixel_t)(fr * factor[i]);
            break;
        }
    };

    if (total_fr > 0 && !content_inline)
    {
        pixel_t remaining_width = render_inline - fixed_width;
        if (remaining_width < 0) remaining_width = 0;
        for (int i = 0; i < num_columns; i++)
            if (is_definite_minmax(i)) remaining_width -= m_grid_layout.column_widths[i] - columns_template[i].get_operands()[0].calc_percent(render_inline);
        if (remaining_width < 0) remaining_width = 0;

        resolve_flex_tracks(remaining_width, nullptr);
    }
    else if (columns_template.empty())
    {
        // The implicit single column is sized after items are known (see below).
        // Block grids fill the available inline size; inline grids shrink-to-fit.
        if (src_el()->css().get_display() != display_inline_grid && !content_inline)
        {
            m_grid_layout.column_widths[0] = render_inline;
        }
    }

    if (content_inline && total_fr > 0)
    {
        // The flex fraction of an intrinsic size is the largest contribution per unit of factor, so
        // `1fr 1fr` over items of 50px and 80px gives two 80px tracks, not 50 and 80.
        auto fr_factor = [&](int i) -> pixel_t {
            const auto& len = columns_template[i];
            if (len.units() == css_units_fr) return len.val();
            if (len.is_calc() && len.get_op() == css_length::op_minmax && len.get_operands()[1].units() == css_units_fr)
                return len.get_operands()[1].val();
            return 0;
        };
        pixel_t fraction = 0;
        for (int i = 0; i < num_columns && i < (int)m_grid_layout.column_widths.size(); i++)
        {
            const pixel_t f = fr_factor(i);
            // (a minmax(base, Nfr) track already holds its base: the fraction cannot be smaller)
            if (f > 0) fraction = std::max(fraction, std::max(fr_contrib[i], m_grid_layout.column_widths[i]) / f);
        }
        if (min_content_constraint) fraction = 0;
        for (int i = 0; i < num_columns && i < (int)m_grid_layout.column_widths.size(); i++)
        {
            const pixel_t f = fr_factor(i);
            m_grid_layout.column_widths[i] = std::max(m_grid_layout.column_widths[i], std::max(f > 0 ? fraction * f : fr_contrib[i], min_content_constraint ? fr_contrib[i] : (pixel_t)0));
        }
    }

    // Content-sized columns (auto, min-content, max-content, fit-content()): size them from the
    // items that sit in a single column, then re-distribute the space left over to fr columns.
    if (!is_multicol)
    {
        std::vector<int> kinds(num_columns, 0);  // 0 fixed/fr, 1 auto, 2 min-content, 3 max-content, 4 fit-content
        bool any_content = false;
        for (int i = 0; i < num_columns && i < (int)columns_template.size(); i++)
        {
            const auto& l = columns_template[i];
            if (l.is_calc())
            {
                if (l.get_op() == css_length::op_fit_content) kinds[i] = 4;
                else if (l.get_op() == css_length::op_minmax && l.get_operands().size() == 2 &&
                         l.get_operands()[1].units() != css_units_fr && !is_definite_minmax(i))
                    kinds[i] = 5;  // minmax(min, <length|auto|max-content>): content clamped to [min, max]
            }
            else if (l.is_predefined())
            {
                kinds[i] = l.predef() == 1 ? 2 : (l.predef() == 2 ? 3 : 1);
            }
            if (kinds[i]) any_content = true;
        }
        if (any_content)
        {
            std::vector<pixel_t> contrib(num_columns, 0);
            std::vector<pixel_t> fit_floor(num_columns, 0);  // fit-content(): min-content contribution
            for (auto& item : m_grid_layout.items)
            {
                if (item.pos.col_end - item.pos.col_start != 1) continue;
                int c = item.pos.col_start;
                if (c >= num_columns || !kinds[c]) continue;
                if (kinds[c] == 4)
                {
                    containing_block_context mcb = self_size;
                    mcb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
                    mcb.size_mode |= containing_block_context::size_mode_content | containing_block_context::size_mode_min_content;
                    fit_floor[c] = std::max(fit_floor[c], (pixel_t)std::ceil(item.el->measure(mcb, fmt_ctx)));
                }
                containing_block_context cb = self_size;
                // The grid's own exact size describes its box, not the intrinsic size of an item.
                cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
                cb.size_mode |= containing_block_context::size_mode_content;
                // a min-content track takes its items' min-content contribution
                if (kinds[c] == 2) cb.size_mode |= containing_block_context::size_mode_min_content;
                pixel_t measured = item.el->measure(cb, fmt_ctx);
                // measure() returns the margin-box inline size (padding and border included), so
                // adding the offsets again would count them twice.
                pixel_t w = std::max((pixel_t)item.el->inline_size(),
                                     measured);
                // Round up: a track a fraction of a pixel too narrow makes the item's text wrap.
                contrib[c] = std::max(contrib[c], (pixel_t)std::ceil(w));
            }
            pixel_t content_total = 0;
            pixel_t gaps = m_grid_layout.column_gap * (num_columns - 1);
            for (int i = 0; i < num_columns; i++)
            {
                if (!kinds[i]) continue;
                pixel_t w = contrib[i];
                // fit-content(limit) = max(min-content, min(max-content, limit))
                if (kinds[i] == 4) w = std::max(fit_floor[i], std::min(w, columns_template[i].get_operands()[0].calc_percent(render_inline)));
                if (kinds[i] == 5)
                {
                    const auto& mm = columns_template[i].get_operands();
                    w = std::max(w, mm[0].calc_percent(render_inline));
                    if (!mm[1].is_predefined()) w = std::min(w, mm[1].calc_percent(render_inline));
                }
                m_grid_layout.column_widths[i] = w;
                content_total += w;
            }

            // Items spanning several columns (CSS Grid 12.5, "increase sizes to accommodate spanning
            // items"; Blink processes them by increasing span, after the single-column ones): what an
            // item needs beyond the tracks it spans is shared equally by the content-sized ones.
            // Items crossing a flexible track are handled by the fr sizing instead.
            {
                std::vector<grid_item*> spanning;
                for (auto& item : m_grid_layout.items)
                {
                    const int span = item.pos.col_end - item.pos.col_start;
                    if (span < 2 || item.pos.col_end > num_columns) continue;
                    bool crosses_flex = false;
                    for (int c = item.pos.col_start; c < item.pos.col_end; c++)
                    {
                        const auto& l = columns_template[c];
                        if (l.units() == css_units_fr ||
                            (l.is_calc() && l.get_op() == css_length::op_minmax && l.get_operands()[1].units() == css_units_fr))
                            crosses_flex = true;
                    }
                    if (!crosses_flex) spanning.push_back(&item);
                }
                std::stable_sort(spanning.begin(), spanning.end(), [](const grid_item* x, const grid_item* y) {
                    return (x->pos.col_end - x->pos.col_start) < (y->pos.col_end - y->pos.col_start);
                });
                for (grid_item* item : spanning)
                {
                    const int c0 = item->pos.col_start, c1 = item->pos.col_end;
                    std::vector<int> targets;
                    bool all_min = true;
                    pixel_t spanned = m_grid_layout.column_gap * (c1 - c0 - 1);
                    for (int c = c0; c < c1; c++)
                    {
                        spanned += m_grid_layout.column_widths[c];
                        if (kinds[c] && kinds[c] != 2) all_min = false;
                        if (kinds[c]) targets.push_back(c);
                    }
                    if (targets.empty()) continue;
                    containing_block_context cb = self_size;
                    cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
                    cb.size_mode |= containing_block_context::size_mode_content;
                    if (all_min) cb.size_mode |= containing_block_context::size_mode_min_content;
                    else targets.erase(std::remove_if(targets.begin(), targets.end(), [&](int c) { return kinds[c] == 2; }), targets.end());
                    if (targets.empty()) continue;
                    pixel_t extra = (pixel_t)std::ceil(item->el->measure(cb, fmt_ctx)) - spanned;
                    // fit-content() / minmax() tracks stop at their limit; the rest takes what they cannot
                    auto cap = [&](int c) -> pixel_t {
                        if (kinds[c] == 4) return std::max(fit_floor[c], columns_template[c].get_operands()[0].calc_percent(render_inline));
                        if (kinds[c] == 5 && !columns_template[c].get_operands()[1].is_predefined())
                            return columns_template[c].get_operands()[1].calc_percent(render_inline);
                        return 1e9f;
                    };
                    for (int round = 0; round < (int)targets.size() && extra > 0.01f; round++)
                    {
                        std::vector<int> open;
                        for (int c : targets) if (m_grid_layout.column_widths[c] < cap(c)) open.push_back(c);
                        if (open.empty()) break;
                        const pixel_t share = extra / open.size();
                        for (int c : open)
                        {
                            const pixel_t add = std::min(share, cap(c) - m_grid_layout.column_widths[c]);
                            m_grid_layout.column_widths[c] += add;
                            content_total += add;
                            extra -= add;
                        }
                    }
                }
            }

            float fr_sum = 0;
            for (int i = 0; i < num_columns; i++)
            {
                const auto& l = columns_template[i];
                if (l.units() == css_units_fr)
                {
                    fr_sum += l.val();
                }
                else if (l.is_calc() && l.get_op() == css_length::op_minmax && l.get_operands()[1].units() == css_units_fr)
                {
                    fr_sum += l.get_operands()[1].val();
                }
            }

            pixel_t fixed2 = gaps + content_total;
            for (int i = 0; i < num_columns; i++)
            {
                if (kinds[i]) continue;
                const auto& l = columns_template[i];
                if (l.units() == css_units_fr) continue;
                if (l.is_calc() && l.get_op() == css_length::op_minmax)
                    fixed2 += l.get_operands()[0].calc_percent(render_inline);
                else if (!l.is_predefined())
                    fixed2 += l.calc_percent(render_inline);
            }
            // `auto` tracks only grow towards their max-content contribution while there is free space.
            // When the tracks overflow a definite grid width, the auto tracks give back what they can:
            // down to each track's minimum contribution, which is 0 for an item that is a scroll
            // container (overflow other than visible) and its min-content size otherwise.
            if (render_inline.value > 0 && fixed2 > render_inline)
            {
                std::vector<int> autos;
                pixel_t auto_total = 0;
                for (int i = 0; i < num_columns; i++)
                    if (kinds[i] == 1) { autos.push_back(i); auto_total += m_grid_layout.column_widths[i]; }
                if (!autos.empty())
                {
                    std::vector<pixel_t> minc(num_columns, 0);
                    for (auto& item : m_grid_layout.items)
                    {
                        if (item.pos.col_end - item.pos.col_start != 1) continue;
                        int c = item.pos.col_start;
                        if (c >= num_columns || kinds[c] != 1) continue;
                        if (item.el->src_el()->css().get_overflow() != overflow_visible) continue;
                        containing_block_context cb = self_size;
                        // The grid's own exact size describes its box, not the intrinsic size of an item.
                        cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
                        cb.size_mode |= containing_block_context::size_mode_min_content;
                        pixel_t measured = item.el->measure(cb, fmt_ctx);
                        pixel_t w = std::max((pixel_t)item.el->inline_size(), measured);
                        minc[c] = std::max(minc[c], std::min((pixel_t)std::ceil(w), m_grid_layout.column_widths[c]));
                    }
                    const pixel_t budget = render_inline - (fixed2 - auto_total);
                    pixel_t min_total = 0;
                    for (int i : autos) min_total += minc[i];
                    // equal growth from the minimums, each track capped at its max-content size
                    pixel_t lo = 0, hi = auto_total;
                    if (budget > min_total)
                    {
                        for (int it = 0; it < 40; it++)
                        {
                            pixel_t t = (lo + hi) / 2, sum = 0;
                            for (int i : autos) sum += std::min(m_grid_layout.column_widths[i], minc[i] + t);
                            if (sum > budget) hi = t; else lo = t;
                        }
                    }
                    else lo = 0;
                    pixel_t new_total = 0;
                    for (int i : autos)
                    {
                        m_grid_layout.column_widths[i] = std::min(m_grid_layout.column_widths[i], minc[i] + lo);
                        new_total += m_grid_layout.column_widths[i];
                    }
                    fixed2 -= auto_total - new_total;
                    content_total -= auto_total - new_total;
                }
            }
            // Intrinsic size with fr tracks next to content tracks (Blink FindFrSize, indefinite space):
            // an item spanning fr tracks gives the fr size (its contribution minus the non-flexible
            // tracks it spans, now that those are sized) / (sum of the spanned factors, at least 1).
            if (content_inline && fr_sum > 0 && !span_fr.empty())
            {
                auto fr_of = [&](int i) -> pixel_t {
                    const auto& l = columns_template[i];
                    if (l.units() == css_units_fr) return l.val();
                    if (l.is_calc() && l.get_op() == css_length::op_minmax && l.get_operands()[1].units() == css_units_fr)
                        return l.get_operands()[1].val();
                    return 0;
                };
                auto base_of = [&](int i) -> pixel_t {
                    const auto& l = columns_template[i];
                    return (l.is_calc() && l.get_op() == css_length::op_minmax) ? l.get_operands()[0].calc_percent(render_inline) : 0;
                };
                pixel_t fraction = 0;
                for (int i = 0; i < num_columns; i++)
                {
                    const pixel_t f = fr_of(i);
                    if (f > 0) fraction = std::max(fraction, std::max(fr_single[i], base_of(i)) / f);
                }
                for (const auto& sp : span_fr)
                {
                    pixel_t left = sp.w - m_grid_layout.column_gap * (sp.c1 - sp.c0 - 1);
                    pixel_t factors = 0;
                    for (int c = sp.c0; c < sp.c1; c++)
                    {
                        if (fr_of(c) > 0) factors += fr_of(c);
                        else left -= m_grid_layout.column_widths[c];
                    }
                    if (left > 0 && factors > 0) fraction = std::max(fraction, left / std::max<pixel_t>(factors, 1));
                }
                for (int i = 0; i < num_columns; i++)
                {
                    const pixel_t f = fr_of(i);
                    if (f > 0) m_grid_layout.column_widths[i] = std::max(base_of(i), fraction * f);
                }
            }
            pixel_t remaining = render_inline - fixed2;
            if (remaining < 0) remaining = 0;
            remaining = maximize_definite_minmax(remaining);
            if (fr_sum > 0 && !content_inline)
            {
                resolve_flex_tracks(remaining, &kinds);
            }
            else if (remaining > 0 && !content_inline)
            {
                // No fr tracks: auto tracks stretch to fill the free space (justify-content: normal), unless
                // the grid is being sized from its content: it then is as wide as its tracks.
                int autos = (int)std::count(kinds.begin(), kinds.end(), 1);
                if (autos > 0)
                {
                    for (int i = 0; i < num_columns; i++)
                        if (kinds[i] == 1) m_grid_layout.column_widths[i] += remaining / autos;
                }
            }
        }
    }

    if (columns_template.empty() && (src_el()->css().get_display() == display_inline_grid || content_inline))
    {
        // Inline grids shrink-to-fit: size the single implicit column to the
        // widest item's content, capped by the available inline size.
        // (Block grids keep filling the available inline size, set above.)
        pixel_t maxc = 0;
        for (auto& item : m_grid_layout.items)
        {
            containing_block_context cb = self_size;
            // The grid's own exact size describes its box, not the intrinsic size of an item.
            cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
            cb.size_mode |= containing_block_context::size_mode_content;
            item.el->measure(cb, fmt_ctx);
            // NB: measure() returns min(content, explicit); the track needs
            // the item's margin-box size (explicit width wins), i.e. inline_size().
            pixel_t w = item.el->inline_size();
            if (w > maxc) maxc = w;
        }
        if (render_inline.type != containing_block_context::cbc_value_type_auto &&
            render_inline.value > 0 && maxc > render_inline.value)
        {
            maxc = render_inline.value;
        }
        m_grid_layout.column_widths[0] = maxc;
    }

    int num_rows = std::max((int)rows_template.size(), max_row);
    // grid-auto-rows sizes implicit rows (those after grid-template-rows). With no
    // value they stay auto (0 here; the measure pass grows them from content).
    length_vector row_tracks = rows_template;
    if (!is_multicol)
    {
        const auto& auto_rows = css().get_grid_auto_rows();
        const int template_rows = (int)rows_template.size();
        for (int i = template_rows; i < num_rows; i++)
        {
            if (auto_rows.empty())
                row_tracks.push_back(css_length::predef_value(0));
            else
                row_tracks.push_back(auto_rows[(i - template_rows) % auto_rows.size()]);
        }
    }
    m_grid_layout.row_heights.assign(num_rows, 0);
    float total_row_fr = 0;
    pixel_t fixed_height = 0;

    // Calculate fixed and percentage rows
    for (int i = 0; i < (int)row_tracks.size(); i++)
    {
        const auto& len = row_tracks[i];
        if (len.units() == css_units_fr)
        {
            total_row_fr += len.val();
        }
        else if (len.is_calc() && len.get_op() == css_length::op_minmax && len.get_operands().size() == 2)
        {
            // minmax(min, max): the row is never shorter than a definite minimum
            const auto& mn = len.get_operands()[0];
            m_grid_layout.row_heights[i] = (!mn.is_predefined() && mn.units() != css_units_fr) ? mn.calc_percent(render_block) : 0;
            fixed_height += m_grid_layout.row_heights[i];
        }
        else
        {
            m_grid_layout.row_heights[i] = len.calc_percent(render_block);
            fixed_height += m_grid_layout.row_heights[i];
        }
    }
    fixed_height += m_grid_layout.row_gap * (num_rows - 1);

    const bool definite_block = render_block.type != containing_block_context::cbc_value_type_auto;

    // Row track kinds, mirroring the column pass: 1 = content-sized, 0 = fixed.
    // Only content-sized tracks may be grown by their items; an item that is larger than an
    // explicitly sized track overflows it instead of resizing it. Flexible (fr) tracks are
    // fixed once the container height gives them a definite size; with an indefinite height
    // they behave like max-content, except that a 0fr track stays at zero (a collapsed
    // `grid-template-rows:0fr` accordion must not expand).
    std::vector<int> row_kinds(num_rows, 1);
    std::vector<int> row_auto(num_rows, 1);
    for (int i = 0; i < num_rows && i < (int)row_tracks.size(); i++)
    {
        const auto& len = row_tracks[i];
        if (len.is_predefined())
        {
            // auto (0), min-content (1), max-content (2)
            row_kinds[i] = 1;
            row_auto[i] = len.predef() == 0 ? 1 : 0;
        }
        else if (len.units() == css_units_fr)
        {
            row_kinds[i] = (!definite_block && len.val() > 0) ? 1 : 0;
            row_auto[i] = 0;
        }
        else if (len.is_calc())
        {
            const auto op = len.get_op();
            row_kinds[i] = (op == css_length::op_fit_content || op == css_length::op_minmax) ? 1 : 0;
            row_auto[i] = 0;
        }
        else if (len.units() == css_units_percentage)
        {
            // A percentage of an indefinite height behaves as auto.
            row_kinds[i] = definite_block ? 0 : 1;
            row_auto[i] = 0;
        }
        else
        {
            row_kinds[i] = 0;  // definite length
            row_auto[i] = 0;
        }
    }

    // Distribute remaining space to fr rows
    if (total_row_fr > 0 && definite_block)
    {
        pixel_t remaining_height = render_block - fixed_height;
        if (remaining_height < 0) remaining_height = 0;
        for (int i = 0; i < (int)row_tracks.size(); i++)
        {
            const auto& len = row_tracks[i];
            if (len.units() == css_units_fr)
            {
                m_grid_layout.row_heights[i] = remaining_height * (len.val() / total_row_fr);
            }
        }
    }

    // `align-items/self: baseline`: the items of a row that share a baseline occupy the row's largest
    // ascent plus its largest descent, which can exceed every item's own height.
    std::map<int, pixel_t> row_ascent, row_descent;
    std::vector<char> baseline_item(m_grid_layout.items.size(), 0);

    // Measure pass
    for (size_t item_idx = 0; item_idx < m_grid_layout.items.size(); item_idx++)
    {
        auto& item = m_grid_layout.items[item_idx];
        pixel_t cell_width = 0;
        for (int i = item.pos.col_start; i < item.pos.col_end && i < num_columns; i++)
        {
            cell_width += m_grid_layout.column_widths[i];
            if (i > item.pos.col_start) cell_width += m_grid_layout.column_gap;
        }

        containing_block_context cb = self_size;
        // content_offset_width() already includes margins, padding and borders
        if (vert)
        {
            cb.render_height = cell_width - item.el->content_offset_height();
            cb.height = cb.render_height;
            cb.width = containing_block_context::cbc_value_type_auto;
        }
        else
        {
            cb.render_width = cell_width - item.el->content_offset_width();
            cb.width = cb.render_width;
            cb.height = containing_block_context::cbc_value_type_auto;
        }
        cb.size_mode |= containing_block_context::size_mode_measure;
        // The grid's own exact-size flags (it is itself being placed into a fixed track) must not
        // leak into sizing its items: their content height has to be measured, not forced.
        cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);

        item.el->measure(cb, fmt_ctx);

        if (!vert && item.pos.row_span() == 1)
        {
            flex_align_items aln = item.el->src_el()->css().get_align_self();
            if (aln == flex_align_items_auto) aln = css().get_flex_align_items();
            if ((aln & 0xFF) == flex_align_items_baseline)
            {
                // The baseline needs laid out lines, which a measure-only pass does not build.
                containing_block_context place_cb = cb;
                place_cb.size_mode &= ~containing_block_context::size_mode_measure;
                item.el->measure(place_cb, fmt_ctx);
                item.el->place(0, 0, place_cb, fmt_ctx);
                const pixel_t ascent = item.el->get_first_baseline();
                const pixel_t descent = std::max<pixel_t>(0, item.el->height() - ascent);
                baseline_item[item_idx] = 1;
                auto& ra = row_ascent[item.pos.row_start];
                auto& rd = row_descent[item.pos.row_start];
                ra = std::max(ra, ascent);
                rd = std::max(rd, descent);
            }
        }
    }

    // Distribute heights
    for (int span = 1; span <= num_rows; span++)
    {
        for (size_t item_idx = 0; item_idx < m_grid_layout.items.size(); item_idx++)
        {
            auto& item = m_grid_layout.items[item_idx];
            if (item.pos.row_span() != span) continue;

            // height() returns margin box height (m_pos.height + margins + padding + borders)
            pixel_t total_h = vert ? item.el->width() : item.el->height();
            if (baseline_item[item_idx]) total_h = std::max(total_h, row_ascent[item.pos.row_start] + row_descent[item.pos.row_start]);
            pixel_t min_content_h = item.el->src_el()->css().get_font_size() * 1.2f;
            // content_offset_height() already includes margins, padding, and borders
            pixel_t content_h = total_h - (vert ? item.el->content_offset_width() : item.el->content_offset_height());
            pixel_t min_h = min_content_h + (vert ? item.el->content_offset_width() : item.el->content_offset_height());
            // The one-line floor only applies to content that actually laid out: an empty item
            // (e.g. a collapsed accordion panel) has a zero height and must not reserve a line.
            // An item with a definite block size is exactly that tall, however small its line is.
            const css_length& item_block_size = vert ? item.el->src_el()->css().get_width() : item.el->src_el()->css().get_height();
            if (content_h > 0 && total_h < min_h && item_block_size.is_predefined()) total_h = min_h;

            pixel_t current_total = 0;
            for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
            {
                current_total += m_grid_layout.row_heights[i];
                if (i > item.pos.row_start) current_total += m_grid_layout.row_gap;
            }

            if (total_h > current_total)
            {
                // Grow only the content-sized tracks in the item's span. A fixedly sized
                // track keeps its specified size and the item overflows it (CSS Grid §11.5).
                int growable = 0;
                for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
                {
                    if (row_kinds[i]) growable++;
                }
                if (growable > 0)
                {
                    pixel_t diff = (total_h - current_total) / growable;
                    for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
                    {
                        if (row_kinds[i]) m_grid_layout.row_heights[i] += diff;
                    }
                }
            }

        }
    }

    // With a definite container height and no fr rows, `auto` tracks absorb the free
    // space (align-content: normal stretches them), mirroring the column pass above.
    // This is what sizes an empty item's row inside an explicitly sized grid.
    if (definite_block && total_row_fr <= 0)
    {
        int autos = (int)std::count(row_auto.begin(), row_auto.end(), 1);
        pixel_t used = num_rows > 0 ? m_grid_layout.row_gap * (num_rows - 1) : 0;
        for (int i = 0; i < num_rows; i++) used += m_grid_layout.row_heights[i];
        const pixel_t leftover = render_block - used;
        if (autos > 0 && leftover > 0)
        {
            for (int i = 0; i < num_rows; i++)
                if (row_auto[i]) m_grid_layout.row_heights[i] += leftover / autos;
        }
    }

    // Calculate totals
    pixel_t acc_x = 0;
    for (int i = 0; i < num_columns; i++) { acc_x += m_grid_layout.column_widths[i] + m_grid_layout.column_gap; }
    pixel_t acc_y = 0;
    for (int i = 0; i < num_rows; i++) { acc_y += m_grid_layout.row_heights[i] + m_grid_layout.row_gap; }

    m_grid_layout.total_grid_width = acc_x > 0 ? acc_x - m_grid_layout.column_gap : 0;
    m_grid_layout.total_grid_height = acc_y > 0 ? acc_y - m_grid_layout.row_gap : 0;

    // Offsets
    m_grid_layout.col_offsets.assign(num_columns, 0);
    m_grid_layout.row_offsets.assign(num_rows, 0);

    pixel_t extra_x = 0;
    pixel_t extra_y = 0;
    pixel_t justify_gap = m_grid_layout.column_gap;
    pixel_t align_gap = m_grid_layout.row_gap;

    auto jc = css().get_flex_justify_content();
    if (jc == flex_justify_content_center) extra_x = (render_inline - m_grid_layout.total_grid_width) / 2;
    else if (jc == flex_justify_content_end || jc == flex_justify_content_flex_end) extra_x = render_inline - m_grid_layout.total_grid_width;
    else if (jc == flex_justify_content_space_between && num_columns > 1) justify_gap += (render_inline - m_grid_layout.total_grid_width) / (num_columns - 1);
    else if (jc == flex_justify_content_space_around && num_columns > 0)
    {
        pixel_t diff = render_inline - m_grid_layout.total_grid_width;
        extra_x = diff / (num_columns * 2);
        justify_gap += diff / num_columns;
    }
    else if (jc == flex_justify_content_space_evenly && num_columns > 0)
    {
        pixel_t diff = render_inline - m_grid_layout.total_grid_width;
        extra_x = diff / (num_columns + 1);
        justify_gap += diff / (num_columns + 1);
    }

    auto ac = css().get_flex_align_content();
    if (render_block.type != containing_block_context::cbc_value_type_auto)
    {
        pixel_t container_h = render_block;
        pixel_t diff = container_h - m_grid_layout.total_grid_height;
        if (ac == flex_align_content_center) extra_y = diff / 2;
        else if (ac == flex_align_content_end || ac == flex_align_content_flex_end) extra_y = diff;
        else if (ac == flex_align_content_space_between && num_rows > 1) align_gap += diff / (num_rows - 1);
        else if (ac == flex_align_content_space_around && num_rows > 0)
        {
            extra_y = diff / (num_rows * 2);
            align_gap += diff / num_rows;
        }
        else if (ac == flex_align_content_space_evenly && num_rows > 0)
        {
            extra_y = diff / (num_rows + 1);
            align_gap += diff / (num_rows + 1);
        }
    }

    acc_x = extra_x;
    for (int i = 0; i < num_columns; i++)
    {
        m_grid_layout.col_offsets[i] = acc_x;
        acc_x += m_grid_layout.column_widths[i] + justify_gap;
    }
    acc_y = extra_y;
    for (int i = 0; i < num_rows; i++)
    {
        m_grid_layout.row_offsets[i] = acc_y;
        acc_y += m_grid_layout.row_heights[i] + align_gap;
    }

    m_grid_layout.justify_gap = justify_gap;
    m_grid_layout.align_gap = align_gap;
}

void litehtml::render_item_grid::place_grid_items(pixel_t x, pixel_t y, const containing_block_context& self_size, formatting_context* fmt_ctx)
{
    int num_columns = (int)m_grid_layout.column_widths.size();
    int num_rows = (int)m_grid_layout.row_heights.size();

    const bool vert = css().get_writing_mode() != writing_mode_horizontal_tb;
    // physical width of the grid container in vertical writing (the block extent rows stack in)
    const pixel_t block_extent = (self_size.render_width.type != containing_block_context::cbc_value_type_auto) ? (pixel_t)self_size.render_width : m_grid_layout.total_grid_height;

    // `align-items/self: baseline`: the items of a row that opt in share one baseline, so the first
    // pass only measures them to find each row's largest ascent; the second pass places everything.
    std::vector<pixel_t> item_baseline(m_grid_layout.items.size(), 0);
    std::map<int, pixel_t> row_baseline;
    for (int pass = 0; pass < 2; pass++)
    for (size_t item_idx = 0; item_idx < m_grid_layout.items.size(); item_idx++)
    {
        auto& item = m_grid_layout.items[item_idx];
        pixel_t item_rel_x = m_grid_layout.col_offsets[item.pos.col_start];
        pixel_t item_rel_y = m_grid_layout.row_offsets[item.pos.row_start];
        
        pixel_t cell_width = 0;
        for (int i = item.pos.col_start; i < item.pos.col_end && i < num_columns; i++)
        {
            cell_width += m_grid_layout.column_widths[i];
            if (i > item.pos.col_start) cell_width += m_grid_layout.justify_gap;
        }
        pixel_t cell_height = 0;
        for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
        {
            cell_height += m_grid_layout.row_heights[i];
            if (i > item.pos.row_start) cell_height += m_grid_layout.align_gap;
        }

        containing_block_context cb = self_size;
        // cell dimensions are margin-box (from height() which returns margin-box).
        // With size_mode_exact_*, CBC applies box_sizing adjustment (padding+border
        // for border-box, 0 for content-box). We want final m_pos = cell - content_offset.
        // So: cb = cell - content_offset + box_sizing → CBC gives cell - content_offset.
        // Columns span the inline axis, rows the block axis: in vertical writing the cell
        // width (columns) is the physical height and the cell height (rows) the physical width.
        const pixel_t cell_w = vert ? cell_height : cell_width;
        const pixel_t cell_h = vert ? cell_width : cell_height;
        cb.render_width = cell_w - item.el->content_offset_width() + item.el->box_sizing_width();
        cb.width = cb.render_width;
        cb.render_height = cell_h - item.el->content_offset_height() + item.el->box_sizing_height();
        cb.height = cb.render_height;
        cb.size_mode |= containing_block_context::size_mode_exact_height;
        cb.size_mode |= containing_block_context::size_mode_exact_width;
        if (!vert)
        {
            // Only an auto-sized item stretches to its grid area (align/justify-self: normal); an
            // item with a definite width or height keeps it and sits at the start of the area.
            const css_length& item_w = item.el->src_el()->css().get_width();
            const css_length& item_h = item.el->src_el()->css().get_height();
            if (!item_w.is_predefined())
            {
                cb.size_mode &= ~containing_block_context::size_mode_exact_width;
                cb.render_width = cell_w;
                cb.width = cell_w;
            }
            if (!item_h.is_predefined())
            {
                cb.size_mode &= ~containing_block_context::size_mode_exact_height;
                cb.render_height = cell_h;
                cb.height = cell_h;
            }
        }

        pixel_t place_x = item_rel_x;
        pixel_t place_y = item_rel_y;
        if (vert)
        {
            // item_rel_x is the inline offset (physical y), item_rel_y the block offset which
            // is measured from the right edge in vertical-rl.
            place_y = item_rel_x;
            place_x = css().get_writing_mode() == writing_mode_vertical_rl ? block_extent - item_rel_y - cell_w : item_rel_y;
        }

        // justify-/align-self (falling back to the container's justify-/align-items): anything
        // but stretch/normal sizes the item to its content and positions it in its grid area.
        pixel_t shift_x = 0;
        pixel_t shift_y = 0;
        flex_justify_content jst = item.el->src_el()->css().get_justify_self();
        if (jst == flex_justify_content_auto) jst = css().get_justify_items();
        flex_align_items aln = item.el->src_el()->css().get_align_self();
        if (aln == flex_align_items_auto) aln = css().get_flex_align_items();
        // `normal` alignment stretches a non-replaced item to its area; a replaced one (an <img>, an
        // <svg>) keeps its own size and sits at the start, and only an explicit `stretch` fills the
        // area. A ratio-only <svg> still takes the area's width: that is its block-level width.
        const bool replaced_item = item.el->src_el()->is_replaced();
        const bool replaced_start_x = replaced_item && !item.el->src_el()->is_ratio_only_replaced();
        const bool j_normal = jst == flex_justify_content_auto || jst == flex_justify_content_normal;
        const bool a_normal = (aln & 0xFF) == flex_align_items_auto || (aln & 0xFF) == flex_align_items_normal;
        const bool j_stretch = (j_normal && !replaced_start_x) || jst == flex_justify_content_stretch;
        const bool a_stretch = (a_normal && !replaced_item) || (aln & 0xFF) == flex_align_items_stretch;
        if (!vert)
        {
            if (!j_stretch && item.el->src_el()->css().get_width().is_predefined())
            {
                cb.size_mode &= ~containing_block_context::size_mode_exact_width;
                cb.size_mode |= containing_block_context::size_mode_content;
                cb.render_width = cell_w;
                cb.width = cell_w;
            }
            if (!a_stretch && item.el->src_el()->css().get_height().is_predefined())
            {
                cb.size_mode &= ~containing_block_context::size_mode_exact_height;
                cb.render_height = cell_h;
                cb.height = cell_h;
            }
        }
        const bool baseline_aligned = !vert && (aln & 0xFF) == flex_align_items_baseline;
        if (pass == 0 && !baseline_aligned) continue;
        item.el->measure(cb, fmt_ctx);
        if (pass == 0)
        {
            item.el->place(x + place_x, y + place_y, cb, fmt_ctx);
            item_baseline[item_idx] = item.el->get_first_baseline();
            auto it = row_baseline.find(item.pos.row_start);
            if (it == row_baseline.end() || it->second < item_baseline[item_idx]) row_baseline[item.pos.row_start] = item_baseline[item_idx];
            continue;
        }
        if (!vert)
        {
            if (baseline_aligned)
            {
                shift_y = row_baseline[item.pos.row_start] - item_baseline[item_idx];
            }
            if (!j_stretch)
            {
                const pixel_t free_w = cell_w - item.el->width();
                if (jst == flex_justify_content_center) shift_x = free_w / 2;
                else if (jst == flex_justify_content_end || jst == flex_justify_content_flex_end || jst == flex_justify_content_right) shift_x = free_w;
            }
            if (!a_stretch && !baseline_aligned)
            {
                const pixel_t free_h = cell_h - item.el->height();
                const int a8 = aln & 0xFF;
                if (a8 == flex_align_items_center) shift_y = free_h / 2;
                else if (a8 == flex_align_items_end || a8 == flex_align_items_flex_end || a8 == flex_align_items_self_end) shift_y = free_h;
            }
        }
        containing_block_context place_cb = cb;
        if (!vert && !j_stretch && item.el->css().get_writing_mode() == writing_mode_horizontal_tb &&
            item.el->src_el()->css().get_width().is_predefined())
        {
            // The item was sized to its content; place it with that width as an exact one so the
            // text-align of its lines applies (it is skipped in the shrink-to-fit mode).
            place_cb.width = item.el->inline_size() - item.el->content_offset_width() + item.el->box_sizing_width();
            place_cb.width.type = containing_block_context::cbc_value_type_absolute;
            place_cb.render_width = place_cb.width;
            place_cb.size_mode |= containing_block_context::size_mode_exact_width;
            place_cb.size_mode &= ~containing_block_context::size_mode_content;
        }
        item.el->place(x + place_x + shift_x, y + place_y + shift_y, place_cb, fmt_ctx);
    }
}

pixel_t litehtml::render_item_grid::_render_content(pixel_t x, pixel_t y, bool /*second_pass*/, const containing_block_context &self_size, formatting_context* fmt_ctx)
{
    calculate_grid_layout(self_size, fmt_ctx);
    if (!(self_size.size_mode & containing_block_context::size_mode_measure))
    {
        place_grid_items(0, 0, self_size, fmt_ctx);
    }

    if (css().get_writing_mode() != writing_mode_horizontal_tb)
    {
        // inline size (physical height) comes from the container, block size (physical width)
        // from the explicit size or the stacked rows
        m_pos.height = self_size.render_height;
        m_pos.width = (self_size.render_width.type != containing_block_context::cbc_value_type_auto) ? (pixel_t)self_size.render_width : m_grid_layout.total_grid_height;
    }
    else
    {
        // A grid sized from its content (a flex item, float, inline-grid, abs) is as wide as its
        // tracks, no wider than the space it was offered when that is known.
        const bool shrink_to_fit =
            ((self_size.size_mode & (containing_block_context::size_mode_content |
                                     containing_block_context::size_mode_min_content)) != 0 &&
             self_size.render_width.type == containing_block_context::cbc_value_type_auto) ||
            (src_el()->css().get_float() != float_none && src_el()->css().get_width().is_predefined());
        m_pos.width = self_size.render_width;
        if (shrink_to_fit)
        {
            m_pos.width = m_grid_layout.total_grid_width;
            if (self_size.render_width.value > 0 && m_pos.width > self_size.render_width.value)
                m_pos.width = self_size.render_width.value;
        }
        m_pos.height = (self_size.render_height.type != containing_block_context::cbc_value_type_auto) ? (pixel_t)self_size.render_height : m_grid_layout.total_grid_height;
    }

    return m_grid_layout.total_grid_width;
}


void render_item_grid::draw_children(uint_ptr hdc, pixel_t x, pixel_t y, const position* clip, draw_flag flag, int zindex)
{
    render_item_block::draw_children(hdc, x, y, clip, flag, zindex);

    if (flag == draw_block && zindex == 0)
    {
        const css_border& rule = src_el()->css().get_column_rule();
        if (rule.style != border_style_none && rule.style != border_style_hidden && m_grid_layout.column_widths.size() > 1)
        {
            pixel_t rule_width = rule.width.val(); // Already converted to px
            if (rule_width <= 0) rule_width = 1;

            position pos = m_pos;
            pos.x += x - get_scroll_left();
            pos.y += y - get_scroll_top();

            for (size_t i = 0; i < m_grid_layout.column_widths.size() - 1; i++)
            {
                // The gap is between column i and column i+1
                pixel_t gap_start = m_grid_layout.col_offsets[i] + m_grid_layout.column_widths[i];
                pixel_t gap_end = m_grid_layout.col_offsets[i + 1];
                
                // Position the rule in the center of the actual gap
                pixel_t rule_x = pos.x + (gap_start + gap_end - rule_width) / 2;
                
                position rule_pos;
                if (css().get_writing_mode() != writing_mode_horizontal_tb)
                {
                    // tracks are stacked vertically, so the rule is a horizontal line
                    rule_pos.x = pos.x;
                    rule_pos.y = pos.y + (gap_start + gap_end - rule_width) / 2;
                    rule_pos.width = m_pos.width;
                    rule_pos.height = rule_width;
                }
                else
                {
                    rule_pos.x = rule_x;
                    rule_pos.y = pos.y;
                    rule_pos.width = rule_width;
                    rule_pos.height = m_pos.height;
                }

                if (rule_pos.does_intersect(clip))
                {
                    if (rule.style == border_style_solid)
                    {
                        background_layer layer;
                        layer.border_box = rule_pos;
                        layer.clip_box = *clip;
                        layer.origin_box = rule_pos;
                        src_el()->get_document()->container()->draw_solid_fill(hdc, layer, rule.color);
                    }
                    else
                    {
                        borders rules;
                        border& rule_edge = css().get_writing_mode() != writing_mode_horizontal_tb ? rules.top : rules.left;
                        rule_edge.width = rule_width;
                        rule_edge.style = rule.style;
                        rule_edge.color = rule.color;
                        src_el()->get_document()->container()->draw_borders(hdc, rules, rule_pos, false);
                    }
                }
            }
        }
    }
}

litehtml::pixel_t litehtml::render_item_grid::get_first_baseline()
{
    if (src_el()->css().get_display() == display_inline_grid && !m_grid_layout.items.empty())
    {
        // An inline grid aligns by the first row: the first item in row-major order.
        const grid_item* best = &m_grid_layout.items.front();
        for (const auto& item : m_grid_layout.items)
        {
            if (item.pos.row_start < best->pos.row_start ||
                (item.pos.row_start == best->pos.row_start && item.pos.col_start < best->pos.col_start))
            {
                best = &item;
            }
        }
        if (best->pos.row_start >= 0 && best->pos.row_start < (int)m_grid_layout.row_offsets.size())
        {
            return m_grid_layout.row_offsets[best->pos.row_start] +
                   best->el->content_offset_top() +
                   best->el->get_first_baseline();
        }
    }
    return render_item_block::get_first_baseline();
}

litehtml::pixel_t litehtml::render_item_grid::get_last_baseline()
{
    if (src_el()->css().get_display() == display_inline_grid && !m_grid_layout.items.empty())
    {
        // Inline-axis (vertical-align) alignment of an inline grid also uses the
        // first row's baseline (Chromium parity).
        return get_first_baseline();
    }
    return render_item_block::get_last_baseline();
}

} // namespace litehtml
