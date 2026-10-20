#include "render_table.h"
#include "document.h"
#include "iterators.h"

#include <algorithm>
#include <vector>


// Width a cell needs in a horizontal table. A cell in an orthogonal (vertical) writing mode
// reports its inline size (physical height) from measure(), but the column needs its block size.
static litehtml::pixel_t measure_cell_width(const std::shared_ptr<litehtml::render_item>& el, const litehtml::containing_block_context& cb, litehtml::formatting_context* fmt_ctx)
{
    const bool horizontal = el->css().get_writing_mode() == litehtml::writing_mode_horizontal_tb;
    // The probe result is a pure function of (element, cb) within a layout pass, and the cell is
    // measured again for real afterwards; memoizing it keeps nested tables from re-probing the same
    // subtree at every level (3^depth).
    litehtml::document* doc = el->src_el()->get_document().get();
    if (horizontal)
    {
        if (el->m_query_epoch != doc->layout_epoch())
        {
            el->m_query_epoch = doc->layout_epoch();
            el->m_query_cache.clear();
        }
        for (auto& e : el->m_query_cache)
            if (e.first == cb) return e.second;
    }
    litehtml::pixel_t inline_size = el->measure(cb, fmt_ctx);
    if (!horizontal) return el->width();
    if (el->m_query_cache.size() >= 6) el->m_query_cache.erase(el->m_query_cache.begin());
    el->m_query_cache.emplace_back(cb, inline_size);
    return inline_size;
}

litehtml::render_item_table::render_item_table(std::shared_ptr<element> _src_el) :
        render_item(std::move(_src_el)),
        m_border_spacing_x(0),
        m_border_spacing_y(0)
{
}

litehtml::pixel_t litehtml::render_item_table::layout_table(pixel_t x, pixel_t y, const containing_block_context &containing_block_size, formatting_context* fmt_ctx)
{
    if (!m_grid) return 0;

    if (get_wm_context().is_vertical())
    {
        return layout_table_vertical(x, y, containing_block_size, fmt_ctx);
    }

	containing_block_context self_size = m_self_size;

    // Calculate table spacing
    pixel_t table_width_spacing = 0;
    if (src_el()->css().get_border_collapse() == border_collapse_separate)
    {
        table_width_spacing = m_border_spacing_x * (m_grid->cols_count() + 1);
    }
    else
    {
        table_width_spacing = 0;

        if (m_grid->cols_count())
        {
            table_width_spacing -= std::max(border_left(), m_grid->column(0).border_left);
            table_width_spacing -= std::max(border_right(), m_grid->column(m_grid->cols_count() - 1).border_right);
        }

        for (int col = 1; col < m_grid->cols_count(); col++)
        {
            table_width_spacing -= std::max(m_grid->column(col).border_left, m_grid->column(col - 1).border_right);
        }
    }


    bool is_fixed_layout = src_el()->css().get_table_layout() == table_layout_fixed;

    if (m_grid->cols_count() == 1 && self_size.width.type != containing_block_context::cbc_value_type_auto)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            table_cell* cell = m_grid->cell(0, row);
            if (cell && cell->el)
            {
				if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
				{
					cell->min_width = cell->max_width = measure_cell_width(cell->el, self_size.new_width(self_size.render_width - table_width_spacing), fmt_ctx);
				} else
				{
					cell->min_width = cell->max_width = measure_cell_width(cell->el, self_size.new_width(self_size.render_width - table_width_spacing), fmt_ctx);
				}
                cell->el->pos().width = cell->min_width - cell->el->content_offset_left() -
						cell->el->content_offset_right();
            }
        }
    }
    else
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            for (int col = 0; col < m_grid->cols_count(); col++)
            {
                table_cell* cell = m_grid->cell(col, row);
                if (cell && cell->el)
                {
					if (is_fixed_layout && row > 0)
					{
						// In fixed layout, contents of cells after the first row do not affect column widths.
						// But we still need to render them to get their height later.
						// We'll render them with a dummy width for now, they will be re-rendered later with correct width.
						cell->min_width = cell->max_width = 0;
						continue;
					}

                    if (!m_grid->column(col).css_width.is_predefined() && m_grid->column(col).css_width.units() != css_units_percentage)
                    {
                        pixel_t css_w = m_grid->column(col).css_width.calc_percent(self_size.width);
						pixel_t el_w = 0;
						if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
						{
							el_w = measure_cell_width(cell->el, self_size.new_width(css_w), fmt_ctx);
						} else
						{
							el_w = measure_cell_width(cell->el, self_size.new_width(css_w), fmt_ctx);
						}
                        cell->min_width = cell->max_width = std::max(css_w, el_w);
                        cell->el->pos().width = cell->min_width - cell->el->content_offset_left() -
								cell->el->content_offset_right();
                    }
                    else
                    {
                        // calculate minimum content width
						if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
						{
							cell->min_width = measure_cell_width(cell->el, self_size.new_width(cell->el->content_offset_width()), fmt_ctx);
							// calculate maximum content width
							cell->max_width = measure_cell_width(cell->el, self_size.new_width(self_size.render_width - table_width_spacing), fmt_ctx);
						} else
						{
							cell->min_width = measure_cell_width(cell->el, self_size.new_width(cell->el->content_offset_width()), fmt_ctx);
							cell->max_width = measure_cell_width(cell->el, self_size.new_width(self_size.render_width - table_width_spacing), fmt_ctx);
						}
                    }
                }
            }
        }
    }

    // For each column, determine a maximum and minimum column width from the cells that span only that column.
    // The minimum is that required by the cell with the largest minimum cell width (or the column 'width', whichever is larger).
    // The maximum is that required by the cell with the largest maximum cell width (or the column 'width', whichever is larger).

    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        m_grid->column(col).max_width = 0;
        m_grid->column(col).min_width = 0;

		if (!m_grid->column(col).css_width.is_predefined())
		{
			if (m_grid->column(col).css_width.units() != css_units_percentage)
			{
				m_grid->column(col).min_width = m_grid->column(col).max_width = m_grid->column(col).css_width.calc_percent(self_size.width);
			}
		}

		if (is_fixed_layout && !m_grid->column(col).css_width.is_predefined())
		{
			if (m_grid->column(col).css_width.units() != css_units_percentage)
			{
				m_grid->column(col).min_width = m_grid->column(col).max_width = m_grid->column(col).css_width.calc_percent(self_size.width);
			}
		}

        for (int row = 0; row < m_grid->rows_count(); row++)
        {
			if (is_fixed_layout && row > 0) break;

            if (m_grid->cell(col, row)->colspan <= 1)
            {
                m_grid->column(col).max_width = std::max(m_grid->column(col).max_width, m_grid->cell(col, row)->max_width);
                m_grid->column(col).min_width = std::max(m_grid->column(col).min_width, m_grid->cell(col, row)->min_width);
            }
        }
    }

    // For each cell that spans more than one column, increase the minimum widths of the columns it spans so that together,
    // they are at least as wide as the cell. Do the same for the maximum widths.
    // If possible, widen all spanned columns by approximately the same amount.

    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            if (m_grid->cell(col, row)->colspan > 1)
            {
                pixel_t max_total_width = m_grid->column(col).max_width;
                pixel_t min_total_width = m_grid->column(col).min_width;
                for (int col2 = col + 1; col2 < col + m_grid->cell(col, row)->colspan; col2++)
                {
                    max_total_width += m_grid->column(col2).max_width;
                    min_total_width += m_grid->column(col2).min_width;
                }
                if (min_total_width < m_grid->cell(col, row)->min_width)
                {
                    m_grid->distribute_min_width(m_grid->cell(col, row)->min_width - min_total_width, col, col + m_grid->cell(col, row)->colspan - 1);
                }
                if (max_total_width < m_grid->cell(col, row)->max_width)
                {
                    m_grid->distribute_max_width(m_grid->cell(col, row)->max_width - max_total_width, col, col + m_grid->cell(col, row)->colspan - 1);
                }
            }
        }
    }

    // If the 'table' or 'inline-table' element's 'width' property has a computed value (W) other than 'auto', the used width is the
    // greater of W, CAPMIN, and the minimum width required by all the columns plus cell spacing or borders (MIN).
    // If the used width is greater than MIN, the extra width should be distributed over the columns.
    //
    // If the 'table' or 'inline-table' element has 'width: auto', the used width is the greater of the table's containing block width,
    // CAPMIN, and MIN. However, if either CAPMIN or the maximum width required by the columns plus cell spacing or borders (MAX) is
    // less than that of the containing block, use max(MAX, CAPMIN).


    pixel_t table_width = 0;
    pixel_t min_table_width = 0;
    pixel_t max_table_width = 0;

    if (self_size.width.type == containing_block_context::cbc_value_type_absolute)
    {
        table_width = m_grid->calc_table_width(self_size.render_width - table_width_spacing, false, min_table_width, max_table_width);
    }
    else
    {
        table_width = m_grid->calc_table_width(self_size.render_width - table_width_spacing, self_size.width.type == containing_block_context::cbc_value_type_auto, min_table_width, max_table_width);
    }

    min_table_width += table_width_spacing;
    max_table_width += table_width_spacing;
    table_width += table_width_spacing;
    m_grid->calc_horizontal_positions(m_borders, src_el()->css().get_border_collapse(), m_border_spacing_x);

    bool row_span_found = false;

    // render cells with computed width
    for (int row = 0; row < m_grid->rows_count(); row++)
    {
        m_grid->row(row).height = 0;
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (cell->el)
            {
                int span_col = col + cell->colspan - 1;
                if (span_col >= m_grid->cols_count())
                {
                    span_col = m_grid->cols_count() - 1;
                }
                pixel_t cell_width = m_grid->column(span_col).right - m_grid->column(col).left;

                //if (cell->el->pos().width != cell_width - cell->el->content_offset_left() -
				//									 cell->el->content_offset_right())
                {
					if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
					{
						cell->el->measure(self_size.new_width(cell_width), fmt_ctx);
					} else
					{
						cell->el->measure(self_size.new_width(cell_width), fmt_ctx);
						cell->el->place(m_grid->column(col).left, 0, self_size.new_width(cell_width), fmt_ctx);
					}
                    cell->el->pos().width = cell_width - cell->el->content_offset_left() -
							cell->el->content_offset_right();
                }
                /*else
                {
                    cell->el->pos().x = m_grid->column(col).left + cell->el->content_offset_left();
                }*/

                if (cell->rowspan <= 1)
                {
                    m_grid->row(row).height = std::max(m_grid->row(row).height, cell->el->height());
                }
                else
                {
                    row_span_found = true;
                }

            }
        }
    }

    if (row_span_found)
    {
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            for (int row = 0; row < m_grid->rows_count(); row++)
            {
                table_cell* cell = m_grid->cell(col, row);
                if (cell->el)
                {
                    int span_row = row + cell->rowspan - 1;
                    if (span_row >= m_grid->rows_count())
                    {
                        span_row = m_grid->rows_count() - 1;
                    }
                    if (span_row != row)
                    {
                        pixel_t h = 0;
                        for (int i = row; i <= span_row; i++)
                        {
                            h += m_grid->row(i).height;
                        }
                        if (h < cell->el->height())
                        {
                            m_grid->row(span_row).height += cell->el->height() - h;
                        }
                    }
                }
            }
        }
    }

    // Calculate vertical table spacing
    pixel_t table_height_spacing = 0;
    if (src_el()->css().get_border_collapse() == border_collapse_separate)
    {
        table_height_spacing = m_border_spacing_y * (m_grid->rows_count() + 1);
    }
    else
    {
        table_height_spacing = 0;

        if (m_grid->rows_count())
        {
            table_height_spacing -= std::max(border_top(), m_grid->row(0).border_top);
            table_height_spacing -= std::max(border_bottom(), m_grid->row(m_grid->rows_count() - 1).border_bottom);
        }

        for (int row = 1; row < m_grid->rows_count(); row++)
        {
            table_height_spacing -= std::max(m_grid->row(row).border_top, m_grid->row(row - 1).border_bottom);
        }
    }


    // calculate block height
    pixel_t block_height = 0;
	if(self_size.height.type != containing_block_context::cbc_value_type_auto && self_size.height > 0)
	{
		block_height = self_size.height - (m_padding.height() + m_borders.height());
	}

    // calculate minimum height from m_css.get_min_height()
    pixel_t min_height = 0;
    if (!src_el()->css().get_min_height().is_predefined() && src_el()->css().get_min_height().units() == css_units_percentage)
    {
		min_height = src_el()->css().get_min_height().calc_percent(containing_block_size.height);
    }
    else
    {
        min_height = (pixel_t)src_el()->css().get_min_height().val();
    }

    pixel_t minimum_table_height = std::max(block_height, min_height);

    m_grid->calc_rows_height(minimum_table_height - table_height_spacing, m_border_spacing_y);
    m_grid->calc_vertical_positions(m_borders, src_el()->css().get_border_collapse(), m_border_spacing_y);

    pixel_t table_height = 0;

    // place cells vertically
    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (cell->el)
            {
                int span_row = row + cell->rowspan - 1;
                if (span_row >= m_grid->rows_count())
                {
                    span_row = m_grid->rows_count() - 1;
                }
                if (!(containing_block_size.size_mode & containing_block_context::size_mode_measure))
                {
                    cell->el->pos().y = m_grid->row(row).top + cell->el->content_offset_top();
                }
                cell->el->pos().height = m_grid->row(span_row).bottom - m_grid->row(row).top -
						cell->el->content_offset_top() -
										 cell->el->content_offset_bottom();
                table_height = std::max(table_height, m_grid->row(span_row).bottom);
                if (!(containing_block_size.size_mode & containing_block_context::size_mode_measure))
                {
                    cell->el->apply_vertical_align();
                }
            }
        }
    }

    if (src_el()->css().get_border_collapse() == border_collapse_collapse)
    {
    }
    else
    {
        table_height += m_border_spacing_y;
    }

    // Render table captions
    // Table border doesn't round the caption, so we have to start caption in the border position
    pixel_t top_captions = -border_top();

    for (auto& caption : m_grid->captions())
    {
		if(caption->css().get_caption_side() == caption_side_top)
		{
			auto cb = self_size.new_width(table_width + border_left() + border_right());
			if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
			{
				caption->measure(cb, fmt_ctx);
			} else
			{
				caption->measure(cb, fmt_ctx);
				caption->place(-border_left(), top_captions, cb, fmt_ctx);
			}
			top_captions += caption->height();
		}
    }

    if (top_captions != 0)
    {
        // Add border height to get the top of cells
        top_captions += border_top();

        // Save caption height for draw_background
		m_grid->top_captions_height(top_captions);

        // Move table cells to the bottom side
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
			if (!(containing_block_size.size_mode & containing_block_context::size_mode_measure))
			{
				m_grid->row(row).el_row->pos().y += top_captions;
			}
            for (int col = 0; col < m_grid->cols_count(); col++)
            {
                table_cell* cell = m_grid->cell(col, row);
                if (cell->el)
                {
					if (!(containing_block_size.size_mode & containing_block_context::size_mode_measure))
					{
						cell->el->pos().y += top_captions;
					}
                }
            }
        }
    }

	pixel_t bottom_captions = 0;

	for (auto& caption : m_grid->captions())
	{
		if(caption->css().get_caption_side() == caption_side_bottom)
		{
			auto cb = self_size.new_width(table_width + border_left() + border_right());
			if (containing_block_size.size_mode & containing_block_context::size_mode_measure)
			{
				caption->measure(cb, fmt_ctx);
			} else
			{
				caption->measure(cb, fmt_ctx);
				caption->place(-border_left(), table_height + top_captions + bottom_captions, cb, fmt_ctx);
			}
			bottom_captions += caption->height();
		}
	}

	if (!(containing_block_size.size_mode & containing_block_context::size_mode_measure))
	{
		m_pos.move_to(x + content_offset_left(), y + content_offset_top());
	}
	m_pos.width = table_width;
	m_pos.height = table_height + top_captions + bottom_captions;

	if(self_size.width.type != containing_block_context::cbc_value_type_absolute)
	{
		return std::min(table_width, max_table_width) + content_offset_width();
	}
	return table_width + content_offset_width();
}

// Table layout for vertical writing modes.
//
// The horizontal algorithm above works in physical axes. A table in vertical writing is its
// transpose: columns run along the inline axis (physical y) and rows stack along the block axis
// (physical x, from the right edge for vertical-rl). The table_grid column/row bookkeeping is
// axis-agnostic, so column.* holds inline-axis data and row.* holds block-axis data here; only
// the conversion to physical coordinates happens at the end.
litehtml::pixel_t litehtml::render_item_table::layout_table_vertical(pixel_t x, pixel_t y, const containing_block_context &containing_block_size, formatting_context* fmt_ctx)
{
    if (!m_grid) return 0;

    containing_block_context self_size = m_self_size;
    const satoru::WritingModeContext wm = get_wm_context();
    const bool rl = wm.mode() == writing_mode_vertical_rl;
    const bool measure_only = (containing_block_size.size_mode & containing_block_context::size_mode_measure) != 0;
    const bool collapse = src_el()->css().get_border_collapse() == border_collapse_collapse;
    const bool is_fixed_layout = src_el()->css().get_table_layout() == table_layout_fixed;

    // border-spacing is physical: horizontal spacing separates rows (block axis),
    // vertical spacing separates columns (inline axis).
    const pixel_t inline_spacing_unit = m_border_spacing_y;
    const pixel_t block_spacing_unit = m_border_spacing_x;

    // The table borders in logical terms: left/right = inline start/end, top/bottom = block start/end.
    margins table_borders;
    table_borders.left = wm.inline_start(m_borders);
    table_borders.right = wm.inline_end(m_borders);
    table_borders.top = wm.block_start(m_borders);
    table_borders.bottom = wm.block_end(m_borders);

    auto cb_inline = [&](pixel_t v) { return self_size.new_inline_size(v); };

    pixel_t inline_spacing = 0;
    if (!collapse)
    {
        inline_spacing = inline_spacing_unit * (m_grid->cols_count() + 1);
    }
    else
    {
        if (m_grid->cols_count())
        {
            inline_spacing -= std::max(table_borders.left, m_grid->column(0).border_left);
            inline_spacing -= std::max(table_borders.right, m_grid->column(m_grid->cols_count() - 1).border_right);
        }
        for (int col = 1; col < m_grid->cols_count(); col++)
        {
            inline_spacing -= std::max(m_grid->column(col).border_left, m_grid->column(col - 1).border_right);
        }
    }

    const pixel_t render_inline = self_size.render_inline_size();

    // 1. min / max inline size of every cell
    for (int row = 0; row < m_grid->rows_count(); row++)
    {
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (!cell || !cell->el) continue;

            if (is_fixed_layout && row > 0)
            {
                cell->min_width = cell->max_width = 0;
                continue;
            }

            const pixel_t offset_inline = cell->el->content_offset_height();
            if (m_grid->cols_count() == 1 && self_size.inline_size().type != containing_block_context::cbc_value_type_auto)
            {
                cell->min_width = cell->max_width = cell->el->measure(cb_inline(render_inline - inline_spacing), fmt_ctx);
                if (!measure_only) cell->el->place(0, 0, cb_inline(render_inline - inline_spacing), fmt_ctx);
            }
            else if (!m_grid->column(col).css_width.is_predefined() && m_grid->column(col).css_width.units() != css_units_percentage)
            {
                pixel_t css_size = m_grid->column(col).css_width.calc_percent(self_size.inline_size());
                pixel_t measured = cell->el->measure(cb_inline(css_size), fmt_ctx);
                if (!measure_only) cell->el->place(0, 0, cb_inline(css_size), fmt_ctx);
                cell->min_width = cell->max_width = std::max(css_size, measured);
            }
            else
            {
                cell->min_width = cell->el->measure(cb_inline(offset_inline), fmt_ctx);
                if (!measure_only) cell->el->place(0, 0, cb_inline(offset_inline), fmt_ctx);
                cell->max_width = cell->el->measure(cb_inline(render_inline - inline_spacing), fmt_ctx);
                if (!measure_only) cell->el->place(0, 0, cb_inline(render_inline - inline_spacing), fmt_ctx);
            }
        }
    }

    // 2. min / max size of every column
    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        table_column& column = m_grid->column(col);
        column.max_width = 0;
        column.min_width = 0;
        if (!column.css_width.is_predefined() && column.css_width.units() != css_units_percentage)
        {
            column.min_width = column.max_width = column.css_width.calc_percent(self_size.inline_size());
        }
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            if (is_fixed_layout && row > 0) break;
            if (m_grid->cell(col, row)->colspan <= 1)
            {
                column.max_width = std::max(column.max_width, m_grid->cell(col, row)->max_width);
                column.min_width = std::max(column.min_width, m_grid->cell(col, row)->min_width);
            }
        }
    }

    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (cell->colspan > 1)
            {
                pixel_t max_total = m_grid->column(col).max_width;
                pixel_t min_total = m_grid->column(col).min_width;
                for (int col2 = col + 1; col2 < col + cell->colspan && col2 < m_grid->cols_count(); col2++)
                {
                    max_total += m_grid->column(col2).max_width;
                    min_total += m_grid->column(col2).min_width;
                }
                if (min_total < cell->min_width)
                {
                    m_grid->distribute_min_width(cell->min_width - min_total, col, col + cell->colspan - 1);
                }
                if (max_total < cell->max_width)
                {
                    m_grid->distribute_max_width(cell->max_width - max_total, col, col + cell->colspan - 1);
                }
            }
        }
    }

    // 3. table inline size
    pixel_t min_table_inline = 0;
    pixel_t max_table_inline = 0;
    const bool inline_is_auto = self_size.inline_size().type == containing_block_context::cbc_value_type_auto;
    pixel_t table_inline = m_grid->calc_table_width(render_inline - inline_spacing,
        self_size.inline_size().type == containing_block_context::cbc_value_type_absolute ? false : inline_is_auto,
        min_table_inline, max_table_inline);
    min_table_inline += inline_spacing;
    max_table_inline += inline_spacing;
    table_inline += inline_spacing;
    m_grid->calc_horizontal_positions(table_borders, src_el()->css().get_border_collapse(), inline_spacing_unit);

    // 4. lay cells out with their final inline size and collect the block size of each row
    bool row_span_found = false;
    std::vector<pixel_t> placed_content_width((size_t)m_grid->rows_count() * (size_t)m_grid->cols_count(), 0);
    for (int row = 0; row < m_grid->rows_count(); row++)
    {
        m_grid->row(row).height = 0;
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (!cell->el) continue;

            int span_col = std::min(col + cell->colspan - 1, m_grid->cols_count() - 1);
            pixel_t cell_inline = m_grid->column(span_col).right - m_grid->column(col).left;

            cell->el->measure(cb_inline(cell_inline), fmt_ctx);
            if (!measure_only) cell->el->place(0, 0, cb_inline(cell_inline), fmt_ctx);
            placed_content_width[(size_t)row * m_grid->cols_count() + col] = cell->el->pos().width;
            cell->el->pos().height = cell_inline - cell->el->content_offset_height();

            if (cell->rowspan <= 1)
            {
                m_grid->row(row).height = std::max(m_grid->row(row).height, cell->el->block_size(wm));
            }
            else
            {
                row_span_found = true;
            }
        }
    }

    if (row_span_found)
    {
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            for (int row = 0; row < m_grid->rows_count(); row++)
            {
                table_cell* cell = m_grid->cell(col, row);
                if (!cell->el) continue;
                int span_row = std::min(row + cell->rowspan - 1, m_grid->rows_count() - 1);
                if (span_row != row)
                {
                    pixel_t h = 0;
                    for (int i = row; i <= span_row; i++) h += m_grid->row(i).height;
                    if (h < cell->el->block_size(wm))
                    {
                        m_grid->row(span_row).height += cell->el->block_size(wm) - h;
                    }
                }
            }
        }
    }

    // 5. rows along the block axis
    pixel_t block_spacing = 0;
    if (!collapse)
    {
        block_spacing = block_spacing_unit * (m_grid->rows_count() + 1);
    }
    else
    {
        if (m_grid->rows_count())
        {
            block_spacing -= std::max(table_borders.top, m_grid->row(0).border_top);
            block_spacing -= std::max(table_borders.bottom, m_grid->row(m_grid->rows_count() - 1).border_bottom);
        }
        for (int row = 1; row < m_grid->rows_count(); row++)
        {
            block_spacing -= std::max(m_grid->row(row).border_top, m_grid->row(row - 1).border_bottom);
        }
    }

    pixel_t css_block = 0;
    if (self_size.block_size().type != containing_block_context::cbc_value_type_auto && self_size.block_size() > 0)
    {
        css_block = self_size.block_size() - (m_padding.width() + m_borders.width());
    }
    pixel_t min_block = 0;
    if (!src_el()->css().get_min_width().is_predefined() && src_el()->css().get_min_width().units() == css_units_percentage)
    {
        min_block = src_el()->css().get_min_width().calc_percent(containing_block_size.width);
    }
    else
    {
        min_block = (pixel_t)src_el()->css().get_min_width().val();
    }

    m_grid->calc_rows_height(std::max(css_block, min_block) - block_spacing, block_spacing_unit);
    m_grid->calc_vertical_positions(table_borders, src_el()->css().get_border_collapse(), block_spacing_unit);

    pixel_t table_block = 0;
    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (!cell->el) continue;
            int span_row = std::min(row + cell->rowspan - 1, m_grid->rows_count() - 1);
            table_block = std::max(table_block, m_grid->row(span_row).bottom);
        }
    }
    if (!collapse) table_block += block_spacing_unit;

    // Captions sit on the block-start (caption-side: top) or block-end (bottom) side of the
    // table and span its inline size, like blocks stacked next to the rows.
    pixel_t top_captions = 0;
    pixel_t bottom_captions = 0;
    {
        const containing_block_context caption_cb = cb_inline(table_inline + table_borders.left + table_borders.right);
        for (auto& caption : m_grid->captions())
        {
            caption->measure(caption_cb, fmt_ctx);
            if (caption->css().get_caption_side() == caption_side_top)
                top_captions += caption->width();
            else
                bottom_captions += caption->width();
        }
    }
    const pixel_t table_total_block = table_block + top_captions + bottom_captions;

    // 6. convert to physical coordinates
    for (int col = 0; col < m_grid->cols_count(); col++)
    {
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (!cell->el) continue;
            int span_col = std::min(col + cell->colspan - 1, m_grid->cols_count() - 1);
            int span_row = std::min(row + cell->rowspan - 1, m_grid->rows_count() - 1);

            pixel_t block_begin = m_grid->row(row).top;
            pixel_t block_end = m_grid->row(span_row).bottom;
            pixel_t final_content_width = block_end - block_begin - cell->el->content_offset_width();

            if (!measure_only)
            {
                // The cell was placed with its measured content width; children of a vertical-rl
                // cell are anchored to the right edge, so follow the final width.
                pixel_t shift = rl ? final_content_width - placed_content_width[(size_t)row * m_grid->cols_count() + col] : 0;
                if (shift != 0)
                {
                    for (auto& child : cell->el->children())
                    {
                        child->pos().x += shift;
                    }
                }
                pixel_t phys_left = rl ? table_total_block - (block_end + top_captions) : block_begin + top_captions;
                cell->el->pos().x = phys_left + cell->el->content_offset_left();
                cell->el->pos().y = m_grid->column(col).left + cell->el->content_offset_top();
            }
            cell->el->pos().width = final_content_width;
            cell->el->pos().height = m_grid->column(span_col).right - m_grid->column(col).left - cell->el->content_offset_height();
        }
    }
    if (!measure_only)
    {
        m_pos.move_to(x + content_offset_left(), y + content_offset_top());
    }

    if (!measure_only)
    {
        const containing_block_context caption_cb = cb_inline(table_inline + table_borders.left + table_borders.right);
        pixel_t top_offset = -table_borders.top;   // block offset of the next block-start caption
        pixel_t bottom_offset = table_block + top_captions;
        for (auto& caption : m_grid->captions())
        {
            const bool is_top = caption->css().get_caption_side() == caption_side_top;
            const pixel_t thickness = caption->width();
            const pixel_t block_offset = is_top ? top_offset : bottom_offset;
            (is_top ? top_offset : bottom_offset) += thickness;
            const pixel_t phys_x = rl ? table_total_block - (block_offset + thickness) : block_offset;
            caption->place(phys_x, -table_borders.left, caption_cb, fmt_ctx);
        }
    }

    // The caption area is not part of the rows, so the table background offset stays 0.
    m_grid->top_captions_height(0);

    m_pos.width = table_total_block;
    m_pos.height = table_inline;

    if (self_size.inline_size().type != containing_block_context::cbc_value_type_absolute)
    {
        return std::min(table_inline, max_table_inline) + content_offset_height();
    }
    return table_inline + content_offset_height();
}

litehtml::pixel_t litehtml::render_item_table::_measure(const containing_block_context &containing_block_size, formatting_context* fmt_ctx)
{
	// For tables, we use the original _render logic but with size_mode_measure
	containing_block_context measure_size = containing_block_size;
	measure_size.size_mode |= containing_block_context::size_mode_measure;
	return layout_table(0, 0, measure_size, fmt_ctx);
}

void litehtml::render_item_table::_place(pixel_t x, pixel_t y, const containing_block_context &containing_block_size, formatting_context* fmt_ctx)
{
	layout_table(x, y, containing_block_size, fmt_ctx);
}

std::shared_ptr<litehtml::render_item> litehtml::render_item_table::init()
{
    // Initialize Grid
    m_grid = std::make_unique<table_grid>();

	for (auto& el : m_children)
	{
		if (el->src_el()->css().get_display() == display_table_column_group)
		{
			el = el->init();
			for (auto& col : el->children())
			{
				if (col->src_el()->css().get_display() == display_table_column)
				{
					col = col->init();
					m_grid->add_column(col);
				}
			}
		}
		else if (el->src_el()->css().get_display() == display_table_column)
		{
			el = el->init();
			m_grid->add_column(el);
		}
	}

    go_inside_table 		table_selector;
    table_rows_selector		row_selector;
    table_cells_selector	cell_selector;

    auto add_row = [&](std::shared_ptr<render_item>& row_el, iterator_item_type /*item_type*/)
        {
            m_grid->begin_row(row_el);


            elements_iterator cell_iter(true, &table_selector, &cell_selector);
            cell_iter.process(row_el, [&](std::shared_ptr<render_item>& el, iterator_item_type item_type)
                {
					if(item_type != iterator_item_type_end_parent)
					{
						el = el->init();
						m_grid->add_cell(el);
					}
                });
        };

    auto add_rows_of = [&](std::shared_ptr<render_item>& child)
        {
            style_display d = child->src_el()->css().get_display();
            if (d == display_table_row)
            {
                add_row(child, iterator_item_type_child);
            }
            else if (d == display_table_row_group || d == display_table_header_group ||
                     d == display_table_footer_group)
            {
                elements_iterator row_iter(false, &table_selector, &row_selector);
                row_iter.process(child, add_row);
            }
        };

    // CSS 2.1 17.2.1: the first header group is rendered above every other row group and the
    // first footer group below them, wherever they appear in the source.
    std::shared_ptr<render_item>* header = nullptr;
    std::shared_ptr<render_item>* footer = nullptr;
    for (auto& child : m_children)
    {
        style_display d = child->src_el()->css().get_display();
        if (d == display_table_header_group && !header) header = &child;
        if (d == display_table_footer_group && !footer) footer = &child;
    }
    if (header) add_rows_of(*header);
    for (auto& child : m_children)
    {
        if (&child != header && &child != footer) add_rows_of(child);
    }
    if (footer) add_rows_of(*footer);

    for (auto& el : m_children)
    {
        if (el->src_el()->css().get_display() == display_table_caption)
        {
            el = el->init();
            m_grid->captions().push_back(el);
        }
    }

    m_grid->set_writing_mode(css().get_writing_mode());
    m_grid->finish();

	if(src_el()->css().get_border_collapse() == border_collapse_separate)
	{
		auto fm = css().get_font_metrics();
		document::ptr doc = src_el()->get_document();
		m_border_spacing_x = doc->to_pixels(src_el()->css().get_border_spacing_x(), fm, 0);
		m_border_spacing_y = doc->to_pixels(src_el()->css().get_border_spacing_y(), fm, 0);
	} else
	{
		m_border_spacing_x	= 0;
		m_border_spacing_y	= 0;
	}

    src_el()->add_render(shared_from_this());

    return shared_from_this();
}

void litehtml::render_item_table::draw_children(uint_ptr hdc, pixel_t x, pixel_t y, const position* clip, draw_flag flag, int zindex)
{
    if (!m_grid) return;

    position pos = m_pos;
    pos.x += x;
    pos.y += y;

    // Table backgrounds
    if (flag == draw_block)
    {
        // <col> / <colgroup> backgrounds sit under the cells. The column box spans the rows area.
        if (css().get_writing_mode() == writing_mode_horizontal_tb && m_grid->rows_count() > 0)
        {
            const pixel_t area_top = m_grid->row(0).top + m_grid->top_captions_height();
            const table_row& last_row = m_grid->row(m_grid->rows_count() - 1);
            const pixel_t area_bottom = last_row.top + last_row.height + m_grid->top_captions_height();
            auto column_span = [&](const std::shared_ptr<render_item>& col, pixel_t& left, pixel_t& right)
            {
                for (int c = 0; c < m_grid->cols_count(); c++)
                {
                    if (m_grid->column(c).el_column == col)
                    {
                        left = m_grid->column(c).left;
                        right = m_grid->column(c).right;
                        return true;
                    }
                }
                return false;
            };
            auto paint_box = [&](const std::shared_ptr<render_item>& ri, pixel_t left, pixel_t right)
            {
                position saved = ri->pos();
                ri->pos() = position(left, area_top, right - left, area_bottom - area_top);
                ri->src_el()->draw_background(hdc, pos.x, pos.y, clip, ri);
                ri->pos() = saved;
            };
            for (auto& child : m_children)
            {
                style_display d = child->src_el()->css().get_display();
                pixel_t left = 0, right = 0;
                if (d == display_table_column && column_span(child, left, right))
                {
                    paint_box(child, left, right);
                }
                else if (d == display_table_column_group)
                {
                    bool found = false;
                    pixel_t group_left = 0, group_right = 0;
                    for (auto& col : child->children())
                    {
                        if (!column_span(col, left, right)) continue;
                        group_left = found ? std::min(group_left, left) : left;
                        group_right = found ? std::max(group_right, right) : right;
                        found = true;
                    }
                    if (found) paint_box(child, group_left, group_right);
                    for (auto& col : child->children())
                    {
                        if (column_span(col, left, right)) paint_box(col, left, right);
                    }
                }
            }
        }

        for (auto& caption : m_grid->captions())
        {
            caption->src_el()->draw_background(hdc, pos.x, pos.y, clip, caption);
        }
        for (int row = 0; row < m_grid->rows_count(); row++)
        {
            m_grid->row(row).el_row->src_el()->draw_background(hdc, pos.x, pos.y, clip, m_grid->row(row).el_row);
            for (int col = 0; col < m_grid->cols_count(); col++)
            {
                table_cell* cell = m_grid->cell(col, row);
                if (cell->el && cell->el->src_el()->css().get_display() == display_table_cell)
                {
                    cell->el->src_el()->draw_background(hdc, pos.x, pos.y, clip, cell->el);
                }
            }
        }
    }

    // Table borders and content
    for (auto& caption : m_grid->captions())
    {
        if (flag == draw_block)
        {
            caption->src_el()->draw_borders(hdc, pos.x, pos.y, clip, caption);
        }
        caption->draw_children(hdc, pos.x, pos.y, clip, flag, zindex);
    }
    for (int row = 0; row < m_grid->rows_count(); row++)
    {
        if (flag == draw_block)
        {
            m_grid->row(row).el_row->src_el()->draw_borders(hdc, pos.x, pos.y, clip, m_grid->row(row).el_row);
        }
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (cell->el)
            {
                if (flag == draw_block)
                {
                    cell->el->src_el()->draw_borders(hdc, pos.x, pos.y, clip, cell->el);
                }
                cell->el->draw_children(hdc, pos.x, pos.y, clip, flag, zindex);
            }
        }
    }
}

litehtml::pixel_t litehtml::render_item_table::get_draw_vertical_offset()
{
    if(m_grid)
    {
        return m_grid->top_captions_height();
    }
    return 0;
}

void litehtml::render_item_table::get_table_row_boundaries( position::vector& boxes ) const
{
    if (!m_grid || m_grid->rows_count() <= 0) return;

    position origin = get_placement();
    const pixel_t captions = m_grid->top_captions_height();
    const int n = m_grid->rows_count();

    // Rows covered by a rowspan>1 cell are merged so the spanned cell is never split.
    std::vector<int> span_end(n, 0);
    for (int row = 0; row < n; row++)
    {
        for (int col = 0; col < m_grid->cols_count(); col++)
        {
            table_cell* cell = m_grid->cell(col, row);
            if (cell && cell->el && cell->rowspan > 1)
            {
                span_end[row] = std::max(span_end[row], row + cell->rowspan - 1);
            }
        }
    }

    for (int i = 0; i < n;)
    {
        int end = std::max(i, std::min(span_end[i], n - 1));
        for (int j = i; j <= end; j++) end = std::max(end, std::min(span_end[j], n - 1));

        position r;
        r.x = origin.x;
        r.width = origin.width;
        r.y = origin.y + m_grid->row(i).top + captions;
        r.height = m_grid->row(end).bottom - m_grid->row(i).top;
        boxes.push_back(r);
        i = end + 1;
    }
}

bool litehtml::render_item_table::get_table_header_boundary( position& box ) const
{
    if (!m_grid || m_grid->rows_count() <= 0) return false;

    const element* table = src_el().get();
    position origin = get_placement();
    const pixel_t captions = m_grid->top_captions_height();

    bool found = false;
    position r;
    for (int row = 0; row < m_grid->rows_count(); row++)
    {
        auto row_ri = m_grid->row(row).el_row;
        if (!row_ri) continue;
        const element* tr = row_ri->src_el().get();
        bool in_header = false;
        for (auto p = tr ? tr->parent() : nullptr; p && p.get() != table; p = p->parent())
        {
            if (p->css().get_display() == display_table_header_group || p->tag() == _thead_)
            {
                in_header = true;
                break;
            }
        }
        if (!in_header) continue;

        position rb;
        rb.x = origin.x;
        rb.width = origin.width;
        rb.y = origin.y + m_grid->row(row).top + captions;
        rb.height = m_grid->row(row).height;
        if (!found)
        {
            r = rb;
            found = true;
        }
        else
        {
            if (rb.y < r.y) r.y = rb.y;
            pixel_t bottom = std::max(r.y + r.height, rb.y + rb.height);
            r.height = bottom - r.y;
        }
    }
    if (found) box = r;
    return found;
}

void litehtml::render_item_table_row::get_inline_boxes( position::vector& boxes ) const
{
	position pos;
	for(auto& el : m_children)
	{
		if(el->src_el()->css().get_display() == display_table_cell)
		{
			pos.x		= el->left() + el->margin_left();
			pos.y		= el->top() - m_padding.top - m_borders.top;

			pos.width	= el->right() - pos.x - el->margin_right() - el->margin_left();
			pos.height	= el->height() + m_padding.top + m_padding.bottom + m_borders.top + m_borders.bottom;

			boxes.push_back(pos);
		}
	}
}
