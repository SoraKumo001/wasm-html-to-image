#include "render_block_context.h"
#include "document.h"
#include "types.h"

litehtml::pixel_t litehtml::render_item_block_context::_render_content(pixel_t /*x*/, pixel_t /*y*/, bool second_pass, const containing_block_context &self_size, formatting_context* fmt_ctx)
{
    element_position el_position;

	pixel_t max_inline_size = 0;
    pixel_t block_offset = 0;
    pixel_t last_block_margin = 0;
    // the only in-flow child is an empty block whose margin already left this box through its top edge
    bool margin_taken_through_top = false;
	std::shared_ptr<render_item> last_margin_el;
    bool is_first = true;
    satoru::WritingModeContext wm = get_wm_context();
    for (const auto& el : m_children)
    {
        // we don't need to process absolute and fixed positioned element on the second pass
        if (second_pass)
        {
            el_position = el->src_el()->css().get_position();
            if ((el_position == element_position_absolute || el_position == element_position_fixed)) continue;
        }

        if(el->src_el()->css().get_float() != float_none)
        {
            pixel_t rw = place_float(el, block_offset, self_size, fmt_ctx);
            if (rw > max_inline_size)
            {
                max_inline_size = rw;
            }
        } else if(el->src_el()->css().get_display() != display_none)
        {
            if(el->src_el()->css().get_position() == element_position_absolute || el->src_el()->css().get_position() == element_position_fixed)
            {
				pixel_t min_rendered_width = el->measure(self_size, fmt_ctx);
				if(min_rendered_width < el->inline_size() && el->src_el()->css().get_width().is_predefined())
				{
					min_rendered_width = el->measure(self_size.new_inline_size(min_rendered_width, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
				}
				if (!(self_size.size_mode & containing_block_context::size_mode_measure))
				{
					el->place_logical(0, block_offset, self_size.new_inline_size(min_rendered_width, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
				}
            } else
            {
                block_offset = fmt_ctx->get_cleared_top(el, block_offset);
                pixel_t inline_offset  = 0;
				pixel_t inline_available_size = self_size.render_inline_size();
				pixel_t line_right	= self_size.render_inline_size();
				pixel_t block_start_margin = margin_block_start();

                // el->calc_outlines(self_size.inline_size()); // measure() will call this

				// Adjust child width for tables and replaced elements with floting blocks width
				if(el->src_el()->is_replaced() ||
				   el->src_el()->is_block_formatting_context() ||
				   el->src_el()->css().get_display() == display_table)
                {
                    pixel_t line_left = 0;
					fmt_ctx->get_line_left_right(block_offset, inline_available_size, line_left, line_right);
					if(line_left != inline_offset)
					{
						inline_offset = line_left - el->margin_inline_start();
					}
					if(line_right != self_size.render_inline_size())
                    {
                        line_right += el->margin_inline_end();
                    }
					if(el->css().get_width().is_predefined())
					{
						inline_available_size = line_right - line_left;
                    }
                }

				pixel_t rw = el->measure(self_size.new_inline_size(inline_available_size, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);

				// Re-get WM context to ensure we have latest container metrics if needed,
				// though for margins it might not matter, but el->get_margins() must be fresh.
				pixel_t current_margin = el->get_wm_context().block_start(el->get_margins());

				// An empty block (no content, no height, no padding or border) collapses through itself:
				// its top and bottom margins are one margin that also adjoins its neighbours' margins
				// (CSS 2.1 8.3.1). Keep the combined margin on the top edge (where the box sits and where
				// it collapses with the previous margin) and report it as the margin the next sibling
				// collapses with, instead of counting top and bottom separately.
				bool self_collapsed = false;
				pixel_t self_collapsed_margin = 0;
				if(el->children().empty() && el->block_size(el->get_wm_context()) == el->get_wm_context().block_start(el->get_margins()) + el->get_wm_context().block_end(el->get_margins()) &&
				   el->src_el()->css().get_display() == display_block && !el->src_el()->is_block_formatting_context() && !el->src_el()->is_replaced() &&
				   el->css().get_height().is_predefined() && el->css().get_min_height().is_predefined())
				{
					const pixel_t mt = el->get_wm_context().block_start(el->get_margins());
					const pixel_t mb = el->get_wm_context().block_end(el->get_margins());
					const pixel_t combined = (mt >= 0 && mb >= 0) ? std::max(mt, mb) : ((mt <= 0 && mb <= 0) ? std::min(mt, mb) : mt + mb);
					el->margin_block_start(combined);
					el->margin_block_end(0);
					current_margin = combined;
					self_collapsed = true;
					// what actually sits in block_offset after this box is its margin collapsed with the one before it
					self_collapsed_margin = is_first ? combined
						: std::max<pixel_t>(0, std::max(last_block_margin, combined)) + std::min<pixel_t>(0, std::min(last_block_margin, combined));
				}

				// Collapse top margin. A negative margin overlaps the previous box (or pulls
				// the first box above the parent's content edge) instead of adding space, so
				// the margin box may not be pushed down by its own negative part.
				if(is_first && collapse_top_margin())
				{
					if (current_margin > 0)
					{
						block_offset -= current_margin;
					}
					if (current_margin > block_start_margin)
					{
						block_start_margin = current_margin;
					}
				} else
				{
					// CSS 2.1 §8.3.1: adjoining margins collapse to the largest positive
					// margin plus the most negative one. `block_offset` already includes the
					// previous bottom margin, so only the difference has to be removed.
					pixel_t collapse = std::max<pixel_t>(0, std::max(last_block_margin, current_margin)) +
					                   std::min<pixel_t>(0, std::min(last_block_margin, current_margin));
					block_offset -= last_block_margin + current_margin - collapse;
				}

				if (!(self_size.size_mode & containing_block_context::size_mode_measure))
				{
					el->place_logical(inline_offset, block_offset, self_size.new_inline_size(inline_available_size, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
				}

				// width: fit-content / max-content / min-content on a block: size the box to its content,
				// like a shrink-to-fit float. The width is still "predefined" (auto) to the rest of layout.
				if(el->src_el()->css().get_display() != display_table && el->css().get_width().is_predefined() && el->css().get_width().predef() > 0)
				{
					const int kw = el->css().get_width().predef();
					int content_mode = (self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)) | containing_block_context::size_mode_content;
					if(kw == 3) content_mode |= containing_block_context::size_mode_min_content;
					rw = el->measure(self_size.new_inline_size(inline_available_size, content_mode), fmt_ctx);
					if(rw < inline_available_size || kw == 3)
					{
						el->measure(self_size.new_inline_size(rw, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
						inline_available_size = rw;
					}
					if (!(self_size.size_mode & containing_block_context::size_mode_measure))
					{
						el->place_logical(inline_offset, block_offset, self_size.new_inline_size(inline_available_size, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
					}
				}

				// Render table with "width: auto" into returned width
				if(el->src_el()->css().get_display() == display_table && rw < inline_available_size && el->src_el()->css().get_width().is_predefined())
				{
					rw = el->measure(self_size.new_inline_size(rw, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
					if (!(self_size.size_mode & containing_block_context::size_mode_measure))
					{
						el->place_logical(inline_offset, block_offset, self_size.new_inline_size(rw, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
					}
				}

				// Check if we need to move block to the next line
				if(el->src_el()->is_replaced() ||
				   el->src_el()->is_block_formatting_context() ||
				   el->src_el()->css().get_display() == display_table)
				{
					if(el->inline_size() > line_right)
					{
                        pixel_t ln_left  = 0;
                        pixel_t ln_right = el->inline_size();
						pixel_t new_block_offset = fmt_ctx->find_next_line_top(block_offset, el->inline_size(), ln_right);
						// If block was moved to the next line, recalculate its position
						if(new_block_offset != block_offset)
						{
							block_offset = new_block_offset;
							fmt_ctx->get_line_left_right(block_offset, el->inline_size(), ln_left, ln_right);
							if (!(self_size.size_mode & containing_block_context::size_mode_measure))
							{
								el->place_logical(ln_left, block_offset, self_size.new_inline_size(inline_available_size, self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)), fmt_ctx);
							}
							block_offset -= wm.block_start(el->get_margins());
							// Rollback top margin collapse
							if(is_first && collapse_top_margin())
							{
								block_start_margin = margin_block_start();
							}
						}
                    }
                }

				if (!(self_size.size_mode & containing_block_context::size_mode_measure))
				{
					pixel_t auto_margin = el->calc_auto_margins(inline_available_size);
					if(auto_margin != 0)
					{
						el->inline_shift(auto_margin);
					}
				}
                if (rw > max_inline_size)
                {
                    max_inline_size = rw;
				}
				margin_block_start(block_start_margin);
                block_offset += el->block_size(wm);
                last_block_margin = self_collapsed ? self_collapsed_margin : wm.block_end(el->get_margins());
				last_margin_el = el;
                margin_taken_through_top = self_collapsed && is_first;
                is_first = false;

                if (el->src_el()->css().get_position() == element_position_relative)
                {
                    el->apply_relative_shift(self_size);
                }
            }
        }
    }

    pixel_t& physical_block_size = (self_size.mode == writing_mode_horizontal_tb) ? m_pos.height : m_pos.width;
    const auto& self_block_size = (self_size.mode == writing_mode_horizontal_tb) ? self_size.height : self_size.width;

    if (self_block_size.type != containing_block_context::cbc_value_type_auto  && self_block_size > 0)
    {
        physical_block_size = (pixel_t)self_block_size;
        if(src_el()->css().get_display() == display_table_cell)
        {
            physical_block_size = std::max(physical_block_size, block_offset);
            if(collapse_bottom_margin())
            {
                if(!margin_taken_through_top) physical_block_size -= last_block_margin;
                if(margin_block_end() < last_block_margin)
                {
                    margin_block_end(last_block_margin);
                }
                if(last_margin_el)
                {
                    last_margin_el->margin_block_end(0);
                }
            }
        }
    } else
    {
        physical_block_size = block_offset;
        if(collapse_bottom_margin())
        {
            if(!margin_taken_through_top) physical_block_size -= last_block_margin;
            if(margin_block_end() < last_block_margin)
            {
                margin_block_end(last_block_margin);
            }
			if(last_margin_el)
			{
				last_margin_el->margin_block_end(0);
			}
        }
    }

    return max_inline_size;
}

litehtml::pixel_t litehtml::render_item_block_context::get_first_baseline()
{
    satoru::WritingModeContext wm = get_wm_context();
	if(m_children.empty())
	{
		return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
	}
	for(const auto &item : m_children)
	{
		if(item->has_baseline())
		{
			return content_offset_block(wm) + item->block_start_pos(wm) + item->get_first_baseline();
		}
	}
	return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
}

litehtml::pixel_t litehtml::render_item_block_context::get_last_baseline()
{
    satoru::WritingModeContext wm = get_wm_context();
	if(m_children.empty())
	{
		return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
	}
	for(auto it = m_children.rbegin(); it != m_children.rend(); ++it)
	{
		if((*it)->has_baseline())
		{
			return content_offset_block(wm) + (*it)->block_start_pos(wm) + (*it)->get_last_baseline();
		}
	}
	return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
}


