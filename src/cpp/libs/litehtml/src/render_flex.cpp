#include "types.h"
#include "render_flex.h"
#include "html_tag.h"
#include "document.h"

#include <cstring>
#include <functional>

litehtml::pixel_t litehtml::render_item_flex::_render_content(pixel_t x, pixel_t y, bool /*second_pass*/, const containing_block_context &self_size, formatting_context* fmt_ctx)
{

	m_pos.width = 0;
	m_pos.height = 0;

	bool is_main_inline = true; // row direction
	bool reverse = false;
	
	switch (css().get_flex_direction())
	{
		case flex_direction_column:
			is_main_inline = false;
			reverse = false;
			break;
		case flex_direction_column_reverse:
			is_main_inline = false;
			reverse = true;
			break;
		case flex_direction_row:
			is_main_inline = true;
			reverse = false;
			break;
		case flex_direction_row_reverse:
			is_main_inline = true;
			reverse = true;
			break;
	}

	// if (self_size.mode != writing_mode_horizontal_tb)
	// {
	// 	is_main_inline = !is_main_inline;
	// }

	pixel_t container_main_size = is_main_inline ? self_size.render_inline_size() : self_size.render_block_size();

	bool single_line = css().get_flex_wrap() == flex_wrap_nowrap;
	bool fit_container = false;

	if(!is_main_inline)
	{
		if(self_size.block_size().type != containing_block_context::cbc_value_type_auto)
		{
			container_main_size = self_size.render_block_size();
		} else
		{
			// Direction columns, block size is auto - always in single line
			container_main_size = 0;
			single_line = true;
			fit_container = true;
		}
	}

	pixel_t main_gap = (pixel_t)(is_main_inline ? css().get_column_gap().calc_percent(container_main_size) : css().get_row_gap().calc_percent(container_main_size));
	pixel_t cross_gap = (pixel_t)(is_main_inline ? css().get_row_gap().calc_percent(self_size.render_block_size()) : css().get_column_gap().calc_percent(self_size.render_inline_size()));

	/////////////////////////////////////////////////////////////////
	/// Split flex items to lines
	/////////////////////////////////////////////////////////////////
	pixel_t sum_cross_size = 0;
	pixel_t sum_main_size = 0;
	pixel_t max_inline_size = 0;
	pixel_t min_content_main = 0;
	const bool min_content_query_col = !is_main_inline && (self_size.size_mode & containing_block_context::size_mode_min_content) &&
		(self_size.size_mode & containing_block_context::size_mode_content) && self_size.mode == writing_mode_horizontal_tb;
	const bool min_content_query = is_main_inline && (self_size.size_mode & containing_block_context::size_mode_min_content) &&
		(self_size.size_mode & containing_block_context::size_mode_content) && self_size.mode == writing_mode_horizontal_tb;

	auto resolve_lines = [&]()
	{
		sum_cross_size = 0;
		sum_main_size = 0;
		max_inline_size = 0;
		min_content_main = 0;
		m_lines = get_lines(self_size, fmt_ctx, is_main_inline, container_main_size, single_line, main_gap);

		/////////////////////////////////////////////////////////////////
		/// Resolving Flexible Lengths
		/// REF: https://www.w3.org/TR/css-flexbox-1/#resolve-flexible-lengths
		/////////////////////////////////////////////////////////////////
		for(auto& ln : m_lines)
		{
			if(is_main_inline)
			{
				// (the hypothetical main size is the base size clamped by min/max-width)
				max_inline_size = std::max(max_inline_size, ln.main_size);
				// max-content size of a wrapping row container is never below its widest item (Blink raises the
				// max-content size to the min-content size, which is the largest single item's contribution).
				if (!single_line && (self_size.size_mode & containing_block_context::size_mode_content) &&
					!(self_size.size_mode & containing_block_context::size_mode_min_content) && self_size.mode == writing_mode_horizontal_tb)
				{
					for (auto& fi : ln.items) max_inline_size = std::max(max_inline_size, fi->min_content_contribution);
				}
				// min-content size of a row container: the items side by side when they cannot wrap, the widest
				// item otherwise (CSS Flexbox 9.9.1); an item contributes its automatic minimum size.
				if ((self_size.size_mode & containing_block_context::size_mode_min_content) &&
					(self_size.size_mode & containing_block_context::size_mode_content) && self_size.mode == writing_mode_horizontal_tb)
				{
					pixel_t min_sum = 0, min_max = 0;
					bool first_item = true;
					for (auto& fi : ln.items)
					{
						min_sum += (first_item ? 0 : main_gap) + fi->min_content_contribution;
						min_max = std::max(min_max, fi->min_content_contribution);
						first_item = false;
					}
					min_content_main = std::max(min_content_main, single_line ? min_sum : min_max);
				}
			}
			ln.init(container_main_size, fit_container, is_main_inline, self_size, fmt_ctx);
			// A block-level column container with an auto width is as wide as the space it is given,
			// not as wide as its widest item (that is what makes it shrink-to-fit, which the content /
			// min-content modes ask for): the one line is the container's width, so stretched items
			// fill it and wide items overflow it.
			if (!is_main_inline && single_line && self_size.mode == writing_mode_horizontal_tb &&
				self_size.width.type == containing_block_context::cbc_value_type_auto &&
				!(self_size.size_mode & (containing_block_context::size_mode_content |
										 containing_block_context::size_mode_min_content)) &&
				css().get_display() == display_flex && self_size.render_width.value > 0)
			{
				ln.cross_size = self_size.render_width.value;
			}
			sum_cross_size += ln.cross_size;

			sum_main_size = std::max(sum_main_size, ln.main_size);
			if(reverse)
			{
				ln.items.reverse();
			}
		}
	};

	resolve_lines();

	// Column container with auto block size: clamp the content-sized main size by
	// min/max block size, then redo flexible length resolution against that size
	// (flex-grow fills min-block-size, flex-shrink fits max-block-size).
	if(fit_container)
	{
		pixel_t clamped = sum_main_size;
		const auto& max_bs = self_size.max_block_size();
		const auto& min_bs = self_size.min_block_size();
		if(max_bs.type != containing_block_context::cbc_value_type_none && clamped > (pixel_t) max_bs)
		{
			clamped = (pixel_t) max_bs;
		}
		if(min_bs.type != containing_block_context::cbc_value_type_none && clamped < (pixel_t) min_bs)
		{
			clamped = (pixel_t) min_bs;
		}
		if(clamped != sum_main_size)
		{
			container_main_size = clamped;
			fit_container = false;
			resolve_lines();
		}
	}

	if(!m_lines.empty())
	{
		sum_cross_size += cross_gap * (pixel_t) (m_lines.size() - 1);
	}

	pixel_t free_cross_size = 0;
	bool is_wrap_reverse = css().get_flex_wrap() == flex_wrap_wrap_reverse;
	// (a column with an auto block size has no main size yet; a row of width 0 really is 0 wide)
	if(container_main_size == 0 && (!is_main_inline || self_size.render_inline_size().type == containing_block_context::cbc_value_type_auto))
	{
		container_main_size = sum_main_size;
	}

	/////////////////////////////////////////////////////////////////
	/// Calculate free cross size
	/////////////////////////////////////////////////////////////////
	if (!(self_size.size_mode & containing_block_context::size_mode_measure))
	{
		if (is_main_inline)
		{
			if (self_size.block_size().type != containing_block_context::cbc_value_type_auto)
			{
				free_cross_size = self_size.render_block_size() - sum_cross_size;
			}
		} else
		{
			free_cross_size = self_size.render_inline_size() - sum_cross_size;
			max_inline_size = sum_cross_size;
		}
	} else
	{
		if (!is_main_inline)
		{
			max_inline_size = sum_cross_size;
		}
	}

	/////////////////////////////////////////////////////////////////
	/// Fix align-content property
	/////////////////////////////////////////////////////////////////
	flex_align_content align_content = css().get_flex_align_content();
	if(align_content == flex_align_content_space_between)
	{
		// If the leftover free-space is negative or there is only a single flex line in the flex
		// container, this value is identical to flex-start.
		if (m_lines.size() == 1 || free_cross_size < 0) align_content = flex_align_content_flex_start;
	}
	if(align_content == flex_align_content_space_around)
	{
		// If the leftover free-space is negative or there is only a single flex line in the flex
		// container, this value is identical to flex-start.
		if (m_lines.size() == 1 || free_cross_size < 0) align_content = flex_align_content_center;
	}

	/////////////////////////////////////////////////////////////////
	/// Distribute free cross size for align-content: stretch
	/////////////////////////////////////////////////////////////////
	if(css().get_flex_align_content() == flex_align_content_stretch && free_cross_size > 0)      
	{
		pixel_t add = free_cross_size / (pixel_t) m_lines.size();
		if(add > 0)
		{
			for (auto &ln: m_lines)
			{
				ln.cross_size += add;
				free_cross_size -= add;
			}
		}
		if(!m_lines.empty())
		{
			while (free_cross_size > 0)
			{
				pixel_t distributeStep = 1;
				for (auto &ln: m_lines)
				{
					ln.cross_size += distributeStep;
					free_cross_size -= distributeStep;
				}
			}
		}
	}

	/// Reverse lines for flex-wrap: wrap-reverse
	if(css().get_flex_wrap() == flex_wrap_wrap_reverse)
	{
		m_lines.reverse();
	}

	/////////////////////////////////////////////////////////////////
	/// Align flex lines
	/////////////////////////////////////////////////////////////////
	pixel_t line_pos = 0;
	pixel_t add_before_line = 0;
	pixel_t add_after_line = 0;
	switch (align_content)
	{
		case flex_align_content_flex_start:
			if(is_wrap_reverse)
			{
				line_pos = free_cross_size;
			}
			break;
		case flex_align_content_flex_end:
			if(!is_wrap_reverse)
			{
				line_pos = free_cross_size;
			}
			break;
		case flex_align_content_end:
			line_pos = free_cross_size;
			break;
		case flex_align_content_center:
			line_pos = free_cross_size / 2;
			break;
		case flex_align_content_space_between:
			add_after_line = free_cross_size / (pixel_t) (m_lines.size() - 1);
			break;
		case flex_align_content_space_around:
			add_before_line = add_after_line = free_cross_size / (pixel_t) (m_lines.size() * 2);
			break;
		default:
			if(is_wrap_reverse)
			{
				line_pos = free_cross_size;
			}
			break;
	}
	for(auto &ln : m_lines)
	{
		line_pos += add_before_line;
		ln.cross_start = line_pos;
		line_pos += ln.cross_size + add_after_line + cross_gap;
	}

	/// Fix justify-content property
	flex_justify_content justify_content = css().get_flex_justify_content();
	if((justify_content == flex_justify_content_right || justify_content == flex_justify_content_left) && !is_main_inline)
	{
		justify_content = flex_justify_content_start;
	}

	/////////////////////////////////////////////////////////////////
	/// Align flex items in flex lines
	/////////////////////////////////////////////////////////////////
	pixel_t max_block_size = 0;
	if (self_size.size_mode & containing_block_context::size_mode_measure)
	{
		for (auto& ln : m_lines)
		{
			pixel_t bs = ln.calculate_items_position(is_main_inline ? ln.main_size : container_main_size,
				flex_justify_content_start,
				is_main_inline,
				self_size,
				fmt_ctx);
			max_block_size = std::max(max_block_size, bs);
		}
	}
	else
	{
		for (auto& ln : m_lines)
		{
			pixel_t bs = ln.calculate_items_position(container_main_size,
				justify_content,
				is_main_inline,
				self_size,
				fmt_ctx);
			max_block_size = std::max(max_block_size, bs);
		}
	}

	// Set physical positions based on writing mode and direction
	if (self_size.mode == writing_mode_horizontal_tb)
	{
		m_pos.width = is_main_inline ? container_main_size : sum_cross_size;
		m_pos.height = is_main_inline ? sum_cross_size : container_main_size;
	}
	else
	{
		m_pos.width = is_main_inline ? sum_cross_size : container_main_size;
		m_pos.height = is_main_inline ? container_main_size : sum_cross_size;
	}



	// Override with explicit sizes if provided
	if (self_size.width.type != containing_block_context::cbc_value_type_auto && self_size.width > 0)
	{
		m_pos.width = self_size.render_width;
	}
    

	if (self_size.height.type != containing_block_context::cbc_value_type_auto && self_size.height > 0)
	{
		m_pos.height = self_size.render_height;
	}

	if (!(self_size.size_mode & containing_block_context::size_mode_measure))
	{
		// calculate the final position
		m_pos.move_to(x, y);
		m_pos.x += content_offset_left();
		m_pos.y += content_offset_top();

		for(auto &ln : m_lines)
		{
			for(auto &item : ln.items)
			{
				item->finalize_position(m_pos.width, m_pos.height);
			}
		}
	}

	for (const auto& el : m_children)
	{
		auto el_position = el->src_el()->css().get_position();
		if (el_position == element_position_absolute || el_position == element_position_fixed)
		{
			containing_block_context el_cb_context = self_size;
			el_cb_context.size_mode = containing_block_context::size_mode_normal;

			// Absolute elements use the padding box as the containing block.
			// render_item_flex::m_pos is the content box, so we add padding.
			el_cb_context.width = m_pos.width + m_padding.width();
			el_cb_context.height = m_pos.height + m_padding.height();
			el_cb_context.render_width = el_cb_context.width;
			el_cb_context.render_height = el_cb_context.height;
			// Absolute elements should be measured as shrink-to-fit for static position.
			el_cb_context.size_mode |= containing_block_context::size_mode_content;

			auto offsets = el->src_el()->css().get_offsets();
			auto el_width = el->src_el()->css().get_width();
			auto el_height = el->src_el()->css().get_height();

			if ((offsets.left.is_predefined() || offsets.right.is_predefined()) && el_width.is_predefined())
			{
				el_cb_context.size_mode |= containing_block_context::size_mode_content;
			}
			if ((offsets.top.is_predefined() || offsets.bottom.is_predefined()) && el_height.is_predefined())
			{
				el_cb_context.size_mode |= containing_block_context::size_mode_content;
			}

			if (self_size.size_mode & containing_block_context::size_mode_measure)
			{
				el->measure(el_cb_context, fmt_ctx);
			} else
			{
				el->measure(el_cb_context, fmt_ctx);
				el->place(0, 0, el_cb_context, fmt_ctx);
			}

			if (!(self_size.size_mode & containing_block_context::size_mode_measure))
			{
				pixel_t static_main = 0;
				pixel_t static_cross = 0;

				auto align_items = css().get_flex_align_items();
				auto align_self = el->src_el()->css().get_flex_align_self();
				if (align_self != flex_align_items_auto) align_items = align_self;

				auto jc = css().get_flex_justify_content();

				pixel_t align_main_size = is_main_inline ? el_cb_context.render_width : el_cb_context.render_height;
				pixel_t align_cross_size = is_main_inline ? el_cb_context.render_height : el_cb_context.render_width;
				pixel_t el_main_size = is_main_inline ? el->inline_size() : el->block_size();
				pixel_t el_cross_size = is_main_inline ? el->block_size() : el->inline_size();

				switch (jc & 0xFF)
				{
					case flex_justify_content_center:
						static_main = (align_main_size - el_main_size) / 2;
						break;
					case flex_justify_content_flex_end:
					case flex_justify_content_end:
						static_main = align_main_size - el_main_size;
						break;
					default: break;
				}
				switch (align_items & 0xFF)
				{
					case flex_align_items_center:
						static_cross = (align_cross_size - el_cross_size) / 2;
						break;
					case flex_align_items_flex_end:
					case flex_align_items_end:
						static_cross = align_cross_size - el_cross_size;
						break;
					default: break;
				}

				satoru::WritingModeContext wm(self_size.mode, m_pos.width, m_pos.height);
				satoru::logical_pos pos = is_main_inline ? satoru::logical_pos(static_main, static_cross) : satoru::logical_pos(static_cross, static_main);
				satoru::logical_size sz(el->inline_size(), el->block_size());
				litehtml::position phys_pos = wm.to_physical(pos, sz);

				el->pos().x = phys_pos.x + el->content_offset_left();
				el->pos().y = phys_pos.y + el->content_offset_top();
			}
		}
	}

	if (min_content_query_col)
	{
		// min-content width of a column container: the widest item's min-content contribution
		pixel_t widest = 0;
		for (auto& ln : m_lines)
			for (auto& fi : ln.items)
			{
				containing_block_context cb = self_size;
				cb.size_mode = (self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content));
				widest = std::max(widest, (pixel_t)fi->el->measure(cb, fmt_ctx));
			}
		return widest;
	}
	return min_content_query ? min_content_main : max_inline_size;
}

std::list<litehtml::flex_line> litehtml::render_item_flex::get_lines(const litehtml::containing_block_context &self_size,
																	 litehtml::formatting_context *fmt_ctx,
																	 bool is_main_inline, pixel_t container_main_size,
																	 bool single_line, pixel_t main_gap)
{
	bool reverse_main;
	bool reverse_cross = css().get_flex_wrap() == flex_wrap_wrap_reverse;

	if(is_main_inline)
	{
		reverse_main = css().get_flex_direction() == flex_direction_row_reverse;
	} else
	{
		reverse_main = css().get_flex_direction() == flex_direction_column_reverse;
	}

	std::list<flex_line> lines;
	flex_line line(reverse_main, reverse_cross, main_gap);
	line.multiline = css().get_flex_wrap() != flex_wrap_nowrap;
	std::list<std::shared_ptr<flex_item>> items;
	int src_order = 0;
	bool sort_required = false;
	def_value<int> prev_order(0);

	for( auto& el : m_children)
	{
		if(el->src_el()->css().get_position() == element_position_absolute || el->src_el()->css().get_position() == element_position_fixed)
		{
			continue;
		}

		std::shared_ptr<flex_item> item = nullptr;
		if(is_main_inline)
		{
			item = std::make_shared<flex_item_row_direction>(el);
		} else
		{
			item = std::make_shared<flex_item_column_direction>(el);
		}
		item->init(self_size, fmt_ctx, css().get_flex_align_items());
		item->src_order = src_order++;

		if(prev_order.is_default())
		{
			prev_order = item->order;
		} else if(!sort_required && item->order != prev_order)
		{
			sort_required = true;
		}

		items.emplace_back(item);
	}

	if(sort_required)
	{
		items.sort([](const std::shared_ptr<flex_item>& item1, const std::shared_ptr<flex_item>& item2)
					   {
							if(item1->order < item2->order) return true; 
							if(item1->order == item2->order)
							{
								return item1->src_order < item2->src_order;
							}
							return false;
					   });
	}

	// Add flex items to lines
	for(auto& item : items)
	{
		pixel_t gap = line.items.empty() ? 0 : main_gap;
		if(!line.items.empty() && !single_line && line.main_size + gap + item->hypothetical_main_size > container_main_size + 0.01)
		{
			lines.emplace_back(line);
			line = flex_line(reverse_main, reverse_cross, main_gap);
			line.multiline = css().get_flex_wrap() != flex_wrap_nowrap;
			gap = 0;
		}
		line.flex_base_size += gap + item->flex_base_size;
		line.main_size += gap + item->hypothetical_main_size;
		if(!item->auto_margin_main_start.is_default()) line.num_auto_margin_main_start++;    
		if(!item->auto_margin_main_end.is_default()) line.num_auto_margin_main_end++;        
		line.items.push_back(item);
	}
	// Add the last line to the lines list
	if(!line.items.empty())
	{
		lines.emplace_back(line);
	}
	return lines;
}

std::shared_ptr<litehtml::render_item> litehtml::render_item_flex::init()
{
    src_el()->add_render(shared_from_this());
    // Compound ruby (<ruby> with two or more <rt>, or with an <rtc>) is laid out as a
    // two-item column-reverse flex box: one anonymous block for the base and one for all
    // annotations. The annotation block collects the contents of every <rt>/<rtc> so the
    // annotation flows as a single line (Chromium distributes it evenly over the base
    // characters; here it is only merged, which is an accepted degradation). Mono ruby
    // (a single <rt> and no <rtc>) keeps the legacy path unchanged.
    if(const char* tag = src_el()->get_tagName(); tag && strcmp(tag, "ruby") == 0)
    {
        int rt_count = 0;
        bool has_rtc = false;
        for(const auto& el : m_children)
        {
            const char* ct = el->src_el()->get_tagName();
            if(ct && strcmp(ct, "rt") == 0) rt_count++;
            else if(ct && strcmp(ct, "rtc") == 0) has_rtc = true;
        }
        if(rt_count >= 2 || has_rtc)
        {
            decltype(m_children) new_children;

            auto make_anon = [&]() -> std::shared_ptr<render_item_block>
                {
                    auto anon_el = std::make_shared<el_anonymous>(src_el()->get_document());
                    auto anon_ri = std::make_shared<render_item_block>(anon_el);
                    anon_ri->parent(shared_from_this());
                    anon_el->parent(src_el());
                    anon_el->compute_styles(false);
                    return anon_ri;
                };

            auto base_ri = make_anon();
            auto anno_ri = make_anon();

            // Collect the annotation content, flattening <rtc> and nested <rt> so it
            // becomes one inline run inside the annotation block.
            std::function<void(const std::shared_ptr<render_item>&)> collect_annotation =
                [&](const std::shared_ptr<render_item>& el)
                {
                    const char* ct = el->src_el()->get_tagName();
                    if(ct && (strcmp(ct, "rt") == 0 || strcmp(ct, "rtc") == 0))
                    {
                        for(const auto& sub : el->children())
                        {
                            collect_annotation(sub);
                        }
                    } else
                    {
                        anno_ri->add_child(el);
                    }
                };

            for(const auto& el : m_children)
            {
                const char* ct = el->src_el()->get_tagName();
                if(ct && (strcmp(ct, "rt") == 0 || strcmp(ct, "rtc") == 0))
                {
                    collect_annotation(el);
                } else if(!el->src_el()->is_white_space())
                {
                    base_ri->add_child(el);
                }
            }

            new_children.push_back(base_ri->init());
            new_children.push_back(anno_ri->init());
            children() = new_children;
            return shared_from_this();
        }
    }

    decltype(m_children) new_children;
    decltype(m_children) inlines;

    auto convert_inlines = [&]()
        {
        if(!inlines.empty())
        {
            // Find last not space
            auto not_space = std::find_if(inlines.rbegin(), inlines.rend(), [&](const std::shared_ptr<render_item>& el)
                {
                return !el->src_el()->is_space();
                });
            if(not_space != inlines.rend())
            {
                // Erase all spaces at the end
                inlines.erase((not_space.base()), inlines.end());
            }

            auto anon_el = std::make_shared<el_anonymous>(src_el()->get_document());
            auto anon_ri = std::make_shared<render_item_block>(anon_el);
            for(const auto& inl : inlines)
            {
                anon_ri->add_child(inl);
            }
            anon_ri->parent(shared_from_this());
            anon_el->parent(src_el());
            anon_el->compute_styles(false);

            new_children.push_back(anon_ri->init());
            inlines.clear();
        }
        };

    for (const auto& el : m_children)
    {
        if((el->src_el()->is_inline() && !el->src_el()->is_inline_box()) || el->src_el()->is_break() || el->src_el()->css().get_display() == display_inline_text || el->src_el()->css().get_display() == display_inline)
        {
            if(!inlines.empty())
            {
                inlines.push_back(el);
            } else
            {
                if (!el->src_el()->is_white_space())
                {
                    inlines.push_back(el);
                }
            }
        } else
        {
            convert_inlines();
            if(el->src_el()->is_block_box())
            {
                // Add block boxes as is
                el->parent(shared_from_this());
                new_children.push_back(el->init());
            } else
            {
                // Wrap inlines with anonymous block box
                auto anon_el = std::make_shared<el_anonymous>(src_el()->get_document());
                auto anon_ri = std::make_shared<render_item_block>(anon_el);
                anon_ri->add_child(el->init());
                anon_ri->parent(shared_from_this());
                anon_el->parent(src_el());
                anon_el->compute_styles(false);
                new_children.push_back(anon_ri->init());
            }
        }
    }
    convert_inlines();
    children() = new_children;

    return shared_from_this();
}

litehtml::pixel_t litehtml::render_item_flex::get_first_baseline()
{
	if(css().get_flex_direction() == flex_direction_row || css().get_flex_direction() == flex_direction_row_reverse)
	{
		if(!m_lines.empty())
		{
			const auto &first_line = m_lines.front();
			if(first_line.first_baseline.type() != baseline::baseline_type_none)
			{
				return first_line.cross_start + first_line.first_baseline.get_offset_from_top(first_line.cross_size) + content_offset_top();
			}
			if(first_line.last_baseline.type() != baseline::baseline_type_none)
			{
				return first_line.cross_start + first_line.last_baseline.get_offset_from_top(first_line.cross_size) + content_offset_top();
			}
		}
	}
	if(!m_lines.empty())
	{
		if(!m_lines.front().items.empty())
		{
			const auto& item_el = m_lines.front().items.front()->el;
			if(css().get_flex_direction() == flex_direction_column || css().get_flex_direction() == flex_direction_column_reverse)
			{
				// cross_pos is horizontal here; the baseline is measured down the block axis.
				return item_el->pos().y - item_el->content_offset_top() + item_el->get_first_baseline() + content_offset_top();
			}
			return m_lines.front().items.front()->cross_pos + item_el->get_first_baseline() + content_offset_top();
		}
	}
	return height();
}

litehtml::pixel_t litehtml::render_item_flex::get_last_baseline()
{
	if(css().get_flex_direction() == flex_direction_row || css().get_flex_direction() == flex_direction_row_reverse)
	{
		if(!m_lines.empty())
		{
			const auto &first_line = m_lines.front();
			if(first_line.last_baseline.type() != baseline::baseline_type_none)
			{
				return first_line.cross_start + first_line.last_baseline.get_offset_from_top(first_line.cross_size) + content_offset_top();
			}
			if(first_line.first_baseline.type() != baseline::baseline_type_none)
			{
				return first_line.cross_start + first_line.first_baseline.get_offset_from_top(first_line.cross_size) + content_offset_top();
			}
		}
	}
	if(!m_lines.empty())
	{
		if(!m_lines.front().items.empty())
		{
			const auto& item_el = m_lines.front().items.front()->el;
			if(css().get_flex_direction() == flex_direction_column || css().get_flex_direction() == flex_direction_column_reverse)
			{
				// cross_pos is horizontal here; the baseline is measured down the block axis.
				return item_el->pos().y - item_el->content_offset_top() + item_el->get_last_baseline() + content_offset_top();
			}
			return m_lines.front().items.front()->cross_pos + item_el->get_last_baseline() + content_offset_top();
		}
	}
	return height();
}
