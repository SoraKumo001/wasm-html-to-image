#include <sstream>
#include <map>
#include <cmath>
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
            if (!el->src_el()->is_white_space())
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

    size_t items_per_col = (items.size() + column_count - 1) / column_count;
    if (items_per_col == 0) items_per_col = 1;
    for (size_t i = 0; i < items.size(); i++)
    {
        size_t col_idx = std::min((size_t)(i / items_per_col), (size_t)(column_count - 1));
        columns[col_idx]->add_child(items[i]);
        items[i]->parent(columns[col_idx]);
    }
    return columns;
}

namespace
{
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

    // Distribute remaining space to fr columns
    if (total_fr > 0)
    {
        pixel_t remaining_width = render_inline - fixed_width;
        if (remaining_width < 0) remaining_width = 0;

        for (int i = 0; i < num_columns; i++)
        {
            const auto& len = columns_template[i];
            if (len.units() == css_units_fr)
            {
                m_grid_layout.column_widths[i] = (pixel_t)(remaining_width * (len.val() / total_fr));
            }
            else if (len.is_calc() && len.get_op() == css_length::op_minmax)
            {
                const auto& max_len = len.get_operands()[1];
                if (max_len.units() == css_units_fr)
                {
                    m_grid_layout.column_widths[i] += (pixel_t)(remaining_width * (max_len.val() / total_fr));
                }
            }
        }
    }
    else if (columns_template.empty())
    {
        // The implicit single column is sized after items are known (see below).
        // Block grids fill the available inline size; inline grids shrink-to-fit.
        if (src_el()->css().get_display() != display_inline_grid)
        {
            m_grid_layout.column_widths[0] = render_inline;
        }
    }

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
        if (r + rs > (int)occupied.size()) occupied.resize(r + rs, vector<bool>(num_columns, false));
        for (int i = r; i < r + rs; i++) {
            for (int j = c; j < c + cs; j++) {
                if (j < num_columns) occupied[i][j] = true;
            }
        }
    };

    int curr_row = 0;
    int curr_col = 0;

    // grid-auto-flow: row dense backfills holes left behind the placement cursor.
    const grid_auto_flow auto_flow = css().get_grid_auto_flow();
    const bool dense = auto_flow == grid_auto_flow_row_dense ||
                       auto_flow == grid_auto_flow_column_dense;

    for (const auto& el : m_children)
    {
        if (el->src_el()->css().get_position() == element_position_absolute || el->src_el()->css().get_position() == element_position_fixed)
            continue;

        grid_line cs, ce, rs, re;
        cs.parse(el->src_el()->css().get_grid_column_start());
        ce.parse(el->src_el()->css().get_grid_column_end());
        rs.parse(el->src_el()->css().get_grid_row_start());
        re.parse(el->src_el()->css().get_grid_row_end());
        resolve_named(cs, col_names, false);
        resolve_named(ce, col_names, true);
        resolve_named(rs, row_names, false);
        resolve_named(re, row_names, true);

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
        if (cs.index <= 0 && !cs.is_span)
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
                         l.get_operands()[1].units() != css_units_fr)
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
            for (auto& item : m_grid_layout.items)
            {
                if (item.pos.col_end - item.pos.col_start != 1) continue;
                int c = item.pos.col_start;
                if (c >= num_columns || !kinds[c]) continue;
                containing_block_context cb = self_size;
                cb.size_mode |= containing_block_context::size_mode_content;
                pixel_t measured = item.el->measure(cb, fmt_ctx);
                // inline_size() is the margin box of the measured box; for text content that box can
                // still be empty (only padding/border), so also use the measured content width.
                pixel_t w = std::max((pixel_t)item.el->inline_size(),
                                     measured + item.el->content_offset_width());
                // Round up: a track a fraction of a pixel too narrow makes the item's text wrap.
                contrib[c] = std::max(contrib[c], (pixel_t)std::ceil(w));
            }
            pixel_t content_total = 0;
            pixel_t gaps = m_grid_layout.column_gap * (num_columns - 1);
            for (int i = 0; i < num_columns; i++)
            {
                if (!kinds[i]) continue;
                pixel_t w = contrib[i];
                if (kinds[i] == 4) w = std::min(w, columns_template[i].get_operands()[0].calc_percent(render_inline));
                if (kinds[i] == 5)
                {
                    const auto& mm = columns_template[i].get_operands();
                    w = std::max(w, mm[0].calc_percent(render_inline));
                    if (!mm[1].is_predefined()) w = std::min(w, mm[1].calc_percent(render_inline));
                }
                m_grid_layout.column_widths[i] = w;
                content_total += w;
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
            pixel_t remaining = render_inline - fixed2;
            if (remaining < 0) remaining = 0;
            if (fr_sum > 0)
            {
                for (int i = 0; i < num_columns; i++)
                {
                    if (kinds[i]) continue;
                    const auto& l = columns_template[i];
                    if (l.units() == css_units_fr)
                    {
                        m_grid_layout.column_widths[i] = (pixel_t)(remaining * (l.val() / fr_sum));
                    }
                    else if (l.is_calc() && l.get_op() == css_length::op_minmax)
                    {
                        m_grid_layout.column_widths[i] = l.get_operands()[0].calc_percent(render_inline);
                        if (l.get_operands()[1].units() == css_units_fr)
                            m_grid_layout.column_widths[i] += (pixel_t)(remaining * (l.get_operands()[1].val() / fr_sum));
                    }
                }
            }
            else if (remaining > 0)
            {
                // No fr tracks: auto tracks stretch to fill the free space (justify-content: normal).
                int autos = (int)std::count(kinds.begin(), kinds.end(), 1);
                if (autos > 0)
                {
                    for (int i = 0; i < num_columns; i++)
                        if (kinds[i] == 1) m_grid_layout.column_widths[i] += remaining / autos;
                }
            }
        }
    }

    if (columns_template.empty() && src_el()->css().get_display() == display_inline_grid)
    {
        // Inline grids shrink-to-fit: size the single implicit column to the
        // widest item's content, capped by the available inline size.
        // (Block grids keep filling the available inline size, set above.)
        pixel_t maxc = 0;
        for (auto& item : m_grid_layout.items)
        {
            containing_block_context cb = self_size;
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
        else
        {
            m_grid_layout.row_heights[i] = len.calc_percent(render_block);
            fixed_height += m_grid_layout.row_heights[i];
        }
    }
    fixed_height += m_grid_layout.row_gap * (num_rows - 1);

    // Distribute remaining space to fr rows
    if (total_row_fr > 0 && render_block.type != containing_block_context::cbc_value_type_auto)
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

    // Measure pass
    for (auto& item : m_grid_layout.items)
    {
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
    }

    // Distribute heights
    for (int span = 1; span <= num_rows; span++)
    {
        for (auto& item : m_grid_layout.items)
        {
            if (item.pos.row_span() != span) continue;

            // height() returns margin box height (m_pos.height + margins + padding + borders)
            pixel_t total_h = vert ? item.el->width() : item.el->height();
            pixel_t min_content_h = item.el->src_el()->css().get_font_size() * 1.2f;
            // content_offset_height() already includes margins, padding, and borders
            pixel_t min_h = min_content_h + (vert ? item.el->content_offset_width() : item.el->content_offset_height());
            if (total_h < min_h) total_h = min_h;

            pixel_t current_total = 0;
            for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
            {
                current_total += m_grid_layout.row_heights[i];
                if (i > item.pos.row_start) current_total += m_grid_layout.row_gap;
            }

            if (total_h > current_total)
            {
                pixel_t diff = total_h - current_total;
                for (int i = item.pos.row_start; i < item.pos.row_end && i < num_rows; i++)
                {
                    m_grid_layout.row_heights[i] += diff / span;
                }
            }

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

    for (auto& item : m_grid_layout.items)
    {
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

        pixel_t place_x = item_rel_x;
        pixel_t place_y = item_rel_y;
        if (vert)
        {
            // item_rel_x is the inline offset (physical y), item_rel_y the block offset which
            // is measured from the right edge in vertical-rl.
            place_y = item_rel_x;
            place_x = css().get_writing_mode() == writing_mode_vertical_rl ? block_extent - item_rel_y - cell_w : item_rel_y;
        }

        item.el->measure(cb, fmt_ctx);
        item.el->place(x + place_x, y + place_y, cb, fmt_ctx);
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
        m_pos.width = self_size.render_width;
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
