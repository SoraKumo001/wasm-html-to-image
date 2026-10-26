#include "render_block_context.h"
#include "document.h"
#include "render_inline_context.h"
#include "element.h"
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
    std::shared_ptr<render_item> prev_child;
    // Max-content sizing puts floats and the inline content beside them on one line.
    const bool max_content_sizing = (self_size.size_mode & containing_block_context::size_mode_content) &&
                                    !(self_size.size_mode & containing_block_context::size_mode_min_content);
    pixel_t float_run_width = 0;
    pixel_t prev_run_rw = 0, prev_run_h = 0;  // the preceding child's measured inline size and block size
    for (const auto& el : m_children)
    {
        struct prev_setter { std::shared_ptr<render_item>& slot; const std::shared_ptr<render_item>& cur; ~prev_setter() { slot = cur; } } set_prev{prev_child, el};
        // we don't need to process absolute and fixed positioned element on the second pass
        if (second_pass)
        {
            el_position = el->src_el()->css().get_position();
            if ((el_position == element_position_absolute || el_position == element_position_fixed)) continue;
        }

        if(el->src_el()->css().get_float() != float_none)
        {
            // A float right after a run of inline content (an anonymous box) joins its last line when it fits,
            // instead of starting below it.
            pixel_t float_offset = block_offset;
            if(prev_child && self_size.mode == writing_mode_horizontal_tb && el->src_el()->css().get_clear() == clear_none)
            {
                auto* run = dynamic_cast<render_item_inline_context*>(prev_child.get());
                pixel_t line_h = 0, used_w = 0;
                const bool is_run = run && (*run->src_el()->get_tagName() == 0 || std::string(run->src_el()->get_tagName()) == "anonymous");
                // (measure passes lay no line boxes out: the run's own extent stands in for its last line)
                if(is_run && !run->last_line_extent(line_h, used_w) && prev_run_h > 0)
                {
                    line_h = prev_run_h;
                    used_w = prev_run_rw;
                }
                if(is_run && line_h > 0)
                {
                    const pixel_t avail = self_size.render_inline_size();
                    const pixel_t float_w = el->measure(self_size.new_inline_size(avail, (self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)) | (el->src_el()->css().get_width().is_predefined() ? containing_block_context::size_mode_content : 0)), fmt_ctx);
                    if(used_w + float_w <= avail + 0.01f) float_offset = block_offset - line_h;
                }
            }
            pixel_t rw = place_float(el, float_offset, self_size, fmt_ctx);
            if (max_content_sizing) float_run_width += rw;
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
				el->set_collapsed_through(false);
				bool only_flow_blocks = true;
					for(const auto& c : el->children())
					{
						const auto& cc = c->src_el()->css();
						// (an out-of-flow positioned child takes no part in the margin collapsing)
						if(cc.get_position() == element_position_absolute || cc.get_position() == element_position_fixed) continue;
						if(cc.get_display() != display_block || cc.get_float() != float_none || !c->collapsed_through())
						{
							only_flow_blocks = false;
							break;
						}
					}
					if(only_flow_blocks && el->block_size(el->get_wm_context()) == el->get_wm_context().block_start(el->get_margins()) + el->get_wm_context().block_end(el->get_margins()) &&
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
					el->set_collapsed_through(true);
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
					if(kw == 1 && rw >= inline_available_size)
					{
						// fit-content never goes below the min-content width: min(max-content, max(min-content, available))
						const pixel_t min_rw = el->measure(self_size.new_inline_size(inline_available_size, content_mode | containing_block_context::size_mode_min_content), fmt_ctx);
						if(min_rw > inline_available_size) rw = min_rw;
					}
					if(rw < inline_available_size || kw == 3 || (kw == 1 && rw > inline_available_size))
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
				if (max_content_sizing)
				{
					const bool is_run = dynamic_cast<render_item_inline_context*>(el.get()) &&
						(*el->src_el()->get_tagName() == 0 || std::string(el->src_el()->get_tagName()) == "anonymous");
					if (is_run) rw += float_run_width; else float_run_width = 0;
				}
                if (rw > max_inline_size)
                {
                    max_inline_size = rw;
				}
				prev_run_rw = rw;
				prev_run_h = el->block_size(wm);
				margin_block_start(block_start_margin);
				// (placing the box laid its content out again, which restored the margins it was given)
				if(self_collapsed)
				{
					el->margin_block_start(current_margin);
					el->margin_block_end(0);
				}
                block_offset += el->block_size(wm);
				// (a cached child handed its bottom margin to its own parent: count it again for this one)
				if(!self_collapsed && wm.block_end(el->get_margins()) == 0) block_offset += el->collapsed_out_margin();
                last_block_margin = self_collapsed ? self_collapsed_margin : wm.block_end(el->get_margins());
				if(!self_collapsed && last_block_margin == 0) last_block_margin = el->collapsed_out_margin();
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
                    last_margin_el->collapse_margin_out();
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
				last_margin_el->collapse_margin_out();
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
		// (an empty inline-block has no line box: its baseline is the bottom margin edge, CSS 2.1 10.8.1)
		if(src_el()->css().get_display() == display_inline_block && !wm.is_vertical()) return block_size(wm);
		return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
	}
	for(const auto &item : m_children)
	{
		// Out-of-flow boxes (floats, absolutely positioned boxes) are not part of the normal flow,
		// so an in-flow box with no line box of its own takes the synthesized bottom-margin-edge
		// baseline below instead of borrowing theirs (same filter as render_item_block).
		const auto& css = item->src_el()->css();
		if(css.get_display() == display_none || css.get_float() != float_none || item->src_el()->is_positioned()) continue;
		if(item->has_baseline())
		{
			// The item sits inside this box's *content* box, so the baseline offset needs this box's
			// block-start edge only (margin + border + padding start). `content_offset_block()`
			// sums both edges, which would add the end margins as well.
			return content_block_start() + item->block_start_pos(wm) - (item->margin_block_start() + item->padding_block_start() + item->border_block_start()) + item->get_first_baseline();
		}
	}
	if(src_el()->css().get_display() == display_inline_block && !wm.is_vertical()) return block_size(wm);
	return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
}

litehtml::pixel_t litehtml::render_item_block_context::get_last_baseline()
{
    satoru::WritingModeContext wm = get_wm_context();
	if(m_children.empty())
	{
		// (an empty inline-block has no line box: its baseline is the bottom margin edge, CSS 2.1 10.8.1)
		if(src_el()->css().get_display() == display_inline_block && !wm.is_vertical()) return block_size(wm);
		return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
	}
	for(auto it = m_children.rbegin(); it != m_children.rend(); ++it)
	{
		const auto& css = (*it)->src_el()->css();
		if(css.get_display() == display_none || css.get_float() != float_none || (*it)->src_el()->is_positioned()) continue;
		if((*it)->has_baseline())
		{
			// Same block-start-only offset as get_first_baseline().
			return content_block_start() + (*it)->block_start_pos(wm) - ((*it)->margin_block_start() + (*it)->padding_block_start() + (*it)->border_block_start()) + (*it)->get_last_baseline();
		}
	}
	if(src_el()->css().get_display() == display_inline_block && !wm.is_vertical()) return block_size(wm);
	return wm.is_vertical() ? default_baseline() : block_size(wm) - margin_block_end();
}


