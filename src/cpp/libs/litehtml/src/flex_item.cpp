#include <cmath>
#include <cstdio>
#include "flex_item.h"
#include "flex_line.h"
#include "types.h"
#include <iostream>

void litehtml::flex_item::init(const litehtml::containing_block_context &self_size_const,
							   litehtml::formatting_context *fmt_ctx, flex_align_items align_items)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	m_container_wm = satoru::WritingModeContext(self_size.mode, (pixel_t) self_size.width, (pixel_t) self_size.height);

	grow = (int) std::nearbyint(el->css().get_flex_grow() * 1000.0);
	if(grow < 0) grow = 0;

	shrink = (int) std::nearbyint(el->css().get_flex_shrink() * 1000.0);
	if(shrink < 0) shrink = 1000;

	el->calc_outlines(self_size.render_inline_size());
	order = el->css().get_order();

	if (el->css().get_flex_align_self() == flex_align_items_auto)
	{
		align = align_items;
	} else
	{
		align = el->css().get_flex_align_self();
	}

	direction_specific_init(self_size, fmt_ctx);

	if (flex_base_size < min_main_size)
	{
		hypothetical_main_size = min_main_size;
	} else if (!max_main_size.is_default() && flex_base_size > max_main_size)
	{
		hypothetical_main_size = max_main_size;
	} else
	{
		hypothetical_main_size = flex_base_size;
	}

	main_size = hypothetical_main_size;
	frozen = false;
}

void litehtml::flex_item::place(flex_line &ln, pixel_t main_pos,
								const containing_block_context &self_size_const,
								formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	layout_item(ln, self_size, fmt_ctx);
	apply_main_auto_margins();
	set_main_position(main_pos);

	if(!apply_cross_auto_margins(ln.cross_size))
	{
		switch (align & 0xFF)
		{
			case flex_align_items_baseline:
				align_baseline(ln, self_size, fmt_ctx);
				break;
			case flex_align_items_flex_end:
				if(ln.reverse_cross)
				{
					set_cross_position(ln.cross_start);
				} else
				{
					set_cross_position(ln.cross_start + ln.cross_size - get_el_cross_size());
				}
				break;
			case flex_align_items_end:
				set_cross_position(ln.cross_start + ln.cross_size - get_el_cross_size());
				break;
			case flex_align_items_center:
				set_cross_position(ln.cross_start + ln.cross_size / 2 - get_el_cross_size() / 2);
				break;
			case flex_align_items_flex_start:
				if(ln.reverse_cross)
				{
					set_cross_position(ln.cross_start + ln.cross_size - get_el_cross_size());
				} else
				{
					set_cross_position(ln.cross_start);
				}
				break;
			case flex_align_items_start:
				set_cross_position(ln.cross_start);
				break;
			default:
				align_stretch(ln, self_size, fmt_ctx);
				break;
		}
	} else {
		set_cross_position(ln.cross_start);
	}
}

litehtml::pixel_t litehtml::flex_item::get_last_baseline(baseline::_baseline_type type) const
{
	if(type == baseline::baseline_type_top)
	{
		return el->get_last_baseline();
	} else if(type == baseline::baseline_type_bottom)
	{
		return el->height() - el->get_last_baseline();
	}
	return 0;
}

litehtml::pixel_t litehtml::flex_item::get_first_baseline(litehtml::baseline::_baseline_type type) const
{
	if(type == baseline::baseline_type_top)
	{
		return el->get_first_baseline();
	} else if(type == baseline::baseline_type_bottom)
	{
		return el->height() - el->get_first_baseline();
	}
	return 0;
}


////////////////////////////////////////////////////////////////////////////////////

void litehtml::flex_item_row_direction::direction_specific_init(const litehtml::containing_block_context &self_size_const,
																litehtml::formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

    // Map logical margins to auto_margin flags
    const auto& margins = el->css().get_margins();
    if(m_container_wm.inline_start(margins).is_predefined()) auto_margin_main_start = 0;
    if(m_container_wm.inline_end(margins).is_predefined()) auto_margin_main_end = 0;
    if(m_container_wm.block_start(margins).is_predefined()) auto_margin_cross_start = true;
    if(m_container_wm.block_end(margins).is_predefined()) auto_margin_cross_end = true;

	def_value<pixel_t> content_size(0);
    
    // No helpers for min/max properties in WritingModeContext, so manual branching
    const css_length& min_size_prop = m_container_wm.is_vertical() ? el->css().get_min_height() : el->css().get_min_width();
    const css_length& max_size_prop = m_container_wm.is_vertical() ? el->css().get_max_height() : el->css().get_max_width();
    const css_length& size_prop = m_container_wm.get_inline_size(el->css()); // Main size prop

    pixel_t render_offset = el->render_offset_width(); 
    if(m_container_wm.is_vertical()) render_offset = el->render_offset_height();

	pixel_t content_offset = el->content_offset_inline(m_container_wm);
	pixel_t parent_size = self_size.render_inline_size();

	if (min_size_prop.is_predefined())
	{
		if (el->css().get_overflow() == overflow_visible ||
			el->src_el()->css().get_display() == display_webkit_box)
		{
			formatting_context fmt_ctx_copy;
			if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
            
            containing_block_context::typed_pixel tp_content_offset(content_offset, containing_block_context::cbc_value_type_auto);
            containing_block_context measure_cb = m_container_wm.update_logical(self_size, tp_content_offset, std::nullopt);
            // The automatic minimum size is the item's min-content size, not its max-content size:
            // measure with size_mode_min_content so cyclic percentage widths (e.g. an image with
            // width:100% inside an auto-width wrapper) contribute 0 instead of their intrinsic
            // width. Otherwise flex-shrink could never bring the item down to the container.
            measure_cb.size_mode = containing_block_context::size_mode_content |
                                   containing_block_context::size_mode_min_content |
                                   containing_block_context::size_mode_measure;
            el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy : nullptr);

			min_main_size = get_el_main_size();
			// Automatic minimum size (CSS Flexbox 4.5) = min(specified size, content size): an item with a
			// definite width may shrink down to its content, not only to that width.
			if (!m_container_wm.is_vertical() && !size_prop.is_predefined() && size_prop.units() != css_units_percentage)
			{
				formatting_context fmt_ctx_copy2;
				if(fmt_ctx) fmt_ctx_copy2 = *fmt_ctx;
				measure_cb.size_mode |= containing_block_context::size_mode_ignore_width;
				el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy2 : nullptr);
				// The specified size is the width property even when flex-basis overrides it for the flex base size.
				min_main_size = std::min(get_el_main_size(), size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm));
			}
			else if (!m_container_wm.is_vertical() && size_prop.units() == css_units_percentage && parent_size > 0 &&
					 !(self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)))
			{
				// A percentage width against a definite container is a specified size too.
				min_main_size = std::min(min_main_size, size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm));
			}
			content_size = min_main_size;
		} else
		{
			min_main_size = render_offset;
			content_size = min_main_size;
		}
	} else
	{
		min_main_size = min_size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm);
	}
	// min-content contribution: a definite width counts in full, otherwise the item's min-content size
	min_content_contribution = min_main_size;
	if (!m_container_wm.is_vertical() && !size_prop.is_predefined() && size_prop.units() != css_units_percentage)
		min_content_contribution = std::max(min_main_size, size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm));
	if (!max_size_prop.is_predefined())
	{
		max_main_size = max_size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm);
	}

	bool flex_basis_predefined = el->css().get_flex_basis().is_predefined();
	int predef = flex_basis_auto;
	if(flex_basis_predefined) predef = el->css().get_flex_basis().predef();
	else if(el->css().get_flex_basis().val() < 0) flex_basis_predefined = true;

	// Fix: If we are measuring the container (intrinsic sizes), we should treat
	// flex-basis as content for growable items or if basis is 0/percentage.
	// CAUTION: Using flex_basis_content instead of flex_basis_max_content so it can wrap appropriately
	// in normal flow.
	// A percentage only falls back to content when the container's inline size is indefinite
	// (an intrinsic-size query); measuring the height at a definite width resolves it normally,
	// otherwise the items take their max-content width and wrap one per line.
	if (!flex_basis_predefined && (self_size.size_mode & containing_block_context::size_mode_measure)) {
		const bool indefinite = (self_size.size_mode & containing_block_context::size_mode_content) ||
								parent_size <= 0;
		// Growable items and a zero basis measure as content only for an intrinsic-size query; at a
		// definite inline size the basis is what the final layout uses, or the line breaking of a
		// wrapping container would differ from the layout and its height would be overestimated.
		// An item that can shrink contributes its content size to an intrinsic size, not its flex-basis:
		// the container may end up narrower than the basis and the item shrinks with it (Blink and the
		// spec's flex fraction both give a shrinkable `flex: 0 1 100px` empty item a contribution of 0).
		const bool shrinkable_in_query = (self_size.size_mode & containing_block_context::size_mode_content) && shrink > 0;
		// ...but a definite width narrower than the basis is that contribution (`width:20px; flex:0 1 100px`).
		const bool width_below_basis = shrinkable_in_query && size_prop.units() == css_units_px && !size_prop.is_predefined() &&
			el->css().get_flex_basis().units() == css_units_px && size_prop.val() < el->css().get_flex_basis().val();
		if (indefinite && width_below_basis)
		{
			flex_basis_predefined = true;
			predef = flex_basis_auto;
		}
		else if (indefinite && (self_size.size_mode & containing_block_context::size_mode_content) &&
				 !size_prop.is_predefined() && size_prop.units() == css_units_px &&
				 el->css().get_flex_basis().units() == css_units_px)
		{
			// A definite width and basis: the contribution is worked out below from the item's own width
			// (CSS Flexbox 9.9.1) instead of measuring its content.
		}
		else if (indefinite && (grow > 0 || shrinkable_in_query || el->css().get_flex_basis().units() == css_units_percentage ||
			el->css().get_flex_basis().val() == 0)) {
			flex_basis_predefined = true;
			predef = flex_basis_content;
		}
	}

	if (flex_basis_predefined)
	{
		if(predef == flex_basis_auto && size_prop.is_predefined()) predef = flex_basis_content;
		// A percentage width (`width:100%`) is cyclic while the container is being sized from its
		// content (an intrinsic-size query with an indefinite inline size): it behaves as auto, so the
		// item contributes its content size instead of the available width. Otherwise an empty
		// `width:100%` child makes its wrapper as wide as the space it is measured in, and the items
		// of a wrapping flex container each fill a line.
		if (predef == flex_basis_auto && !m_container_wm.is_vertical() &&
			(size_prop.units() == css_units_percentage || (size_prop.is_calc() && size_prop.calc_percent() != 0)) &&
			(self_size.size_mode & (containing_block_context::size_mode_content | containing_block_context::size_mode_min_content)) &&
			self_size.render_inline_size().type == containing_block_context::cbc_value_type_auto)
		{
			predef = flex_basis_content;
		}

		switch (predef)
		{
			case flex_basis_auto:
				flex_base_size = size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm);
				break;
			case flex_basis_fit_content:
			case flex_basis_content:
				{
					formatting_context fmt_ctx_copy;
					if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
                    
                    pixel_t logical_is_val = m_container_wm.to_logical(self_size.width, self_size.height).inline_size + content_offset;
                    containing_block_context::typed_pixel tp_logical_is(logical_is_val, containing_block_context::cbc_value_type_auto);
                    
                    containing_block_context measure_cb = m_container_wm.update_logical(self_size, tp_logical_is, std::nullopt);
                    measure_cb.size_mode = containing_block_context::size_mode_measure | containing_block_context::size_mode_content;
                    
					el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy : nullptr);
					flex_base_size = get_el_main_size();
				}
				break;
			case flex_basis_min_content:
				if(content_size.is_default())
				{
					formatting_context fmt_ctx_copy;
					if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
                    
                    containing_block_context::typed_pixel tp_content_offset(content_offset, containing_block_context::cbc_value_type_auto);
                    containing_block_context measure_cb = m_container_wm.update_logical(self_size, tp_content_offset, std::nullopt);
                    measure_cb.size_mode = containing_block_context::size_mode_content | containing_block_context::size_mode_measure;
                    
					el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy : nullptr);
					content_size = get_el_main_size();
				}
				flex_base_size = content_size;
				break;
			case flex_basis_max_content:
				{
					formatting_context fmt_ctx_copy;
					if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
                    
                    containing_block_context::typed_pixel tp_zero(0, containing_block_context::cbc_value_type_auto);
                    containing_block_context measure_cb = m_container_wm.update_logical(self_size, tp_zero, std::nullopt);
                    measure_cb.size_mode = containing_block_context::size_mode_measure | containing_block_context::size_mode_content;
                    
					el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy : nullptr);
					flex_base_size = get_el_main_size();
				}
				break;
			default:
				flex_base_size = 0;
				break;
		}
	} else
	{
		flex_base_size = el->css().get_flex_basis().calc_percent(parent_size) + render_offset - el->box_sizing_inline(m_container_wm);
		// The max-content size of a wrapping container sums its items' max-content contributions, which
		// come from their own width rather than from their flex-basis.
		if (!m_container_wm.is_vertical() && el->parent() &&
			(self_size.size_mode & containing_block_context::size_mode_measure) &&
			(self_size.size_mode & containing_block_context::size_mode_content) &&
			!size_prop.is_predefined() && size_prop.units() == css_units_px)
		{
			const pixel_t own = size_prop.val() + render_offset - el->box_sizing_inline(m_container_wm);
			// CSS Flexbox 9.9.1 (Blink's max-content contribution, wrapping or not): the item's own size, kept
			// within its flex base size from above when it cannot grow and from below when it cannot shrink.
			pixel_t contribution = own;
			if (!(grow > 0)) contribution = std::min(contribution, flex_base_size);
			if (!(shrink > 0)) contribution = std::max(contribution, flex_base_size);
			flex_base_size = contribution;
		}
	}

	// A replaced item with an intrinsic ratio that is stretched to a definite container height transfers
	// that height to its main size (CSS Flexbox 9.2): the flex base size follows the stretched cross size.
	if (!m_container_wm.is_vertical() && el->src_el()->is_replaced() && el->css().get_flex_basis().is_predefined() && el->css().get_flex_basis().predef() == flex_basis_auto &&
		self_size.render_height.type != containing_block_context::cbc_value_type_auto &&
		size_prop.is_predefined() && size_prop.predef() == 0 &&
		el->css().get_height().is_predefined() && el->css().get_height().predef() == 0 &&
		((align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal) &&
		el->parent() && el->parent()->css().get_flex_wrap() == flex_wrap_nowrap)
	{
		litehtml::size sz;
		el->src_el()->get_content_size(sz, 0);
		if (sz.width > 0 && sz.height > 0)
		{
			const pixel_t cross = std::max<pixel_t>(0, (pixel_t)self_size.render_height - el->content_offset_block(m_container_wm));
			flex_base_size = cross * sz.width / sz.height + render_offset;
			// The automatic minimum is then the transferred size too, not the intrinsic width: an image
			// squeezed to a container shorter than itself gets narrower, not stuck at its natural width.
			if (min_size_prop.is_predefined() && min_main_size > flex_base_size)
			{
				min_main_size = flex_base_size;
				min_content_contribution = std::min(min_content_contribution, flex_base_size);
			}
		}
	}

	scaled_flex_shrink_factor = (flex_base_size - render_offset) * shrink;
}

void litehtml::flex_item_row_direction::apply_main_auto_margins()
{
    if(!auto_margin_main_start.is_default()) m_container_wm.set_inline_start(el->get_margins(), auto_margin_main_start);
    if(!auto_margin_main_end.is_default()) m_container_wm.set_inline_end(el->get_margins(), auto_margin_main_end);
}

bool litehtml::flex_item_row_direction::apply_cross_auto_margins(pixel_t cross_size)
{
	if(auto_margin_cross_end || auto_margin_cross_start)
	{
		int margins_num = 0;
		if(auto_margin_cross_end) margins_num++;
		if(auto_margin_cross_start) margins_num++;
		pixel_t margin = (cross_size - get_el_cross_size()) / margins_num;

        if(auto_margin_cross_start) m_container_wm.set_block_start(el->get_margins(), margin);
        if(auto_margin_cross_end) m_container_wm.set_block_end(el->get_margins(), margin);
        
		return true;
	}
	return false;
}

void litehtml::flex_item_row_direction::set_main_position(pixel_t pos)
{
    main_pos = pos;
}

void litehtml::flex_item_row_direction::set_cross_position(pixel_t pos)
{
    cross_pos = pos;
}

void litehtml::flex_item_row_direction::layout_item(litehtml::flex_line &ln,
													   const litehtml::containing_block_context &self_size_const,
													   litehtml::formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	containing_block_context child_cb = self_size;
	child_cb.mode = m_container_wm.mode();
    // Main Axis = Inline
    child_cb.inline_size() = main_size - el->content_offset_inline(m_container_wm) + el->box_sizing_inline(m_container_wm);
    child_cb.render_inline_size() = child_cb.inline_size();

	bool stretch = ((align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal) &&
                   !auto_margin_cross_start && !auto_margin_cross_end;
	const css_length& cross_prop = m_container_wm.get_block_size(el->css());

	if (stretch && (cross_prop.is_predefined() && cross_prop.predef() == 0))
	{
        // Cross Axis = Block
        child_cb.block_size() = ln.cross_size - el->content_offset_block(m_container_wm) + el->box_sizing_block(m_container_wm);
        child_cb.render_block_size() = child_cb.block_size();
		child_cb.size_mode = containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height;
		// The stretched size is not definite for percentage children while the container height is auto.
		if (self_size_const.height.type == containing_block_context::cbc_value_type_auto && !m_container_wm.is_vertical())
			child_cb.size_mode |= containing_block_context::size_mode_cyclic_height;
	} else {
        child_cb.block_size().type = containing_block_context::cbc_value_type_auto;
        child_cb.render_block_size().type = containing_block_context::cbc_value_type_auto;
        child_cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
        
        if (m_container_wm.is_vertical())
        {
            child_cb.size_mode |= containing_block_context::size_mode_exact_height;
        } else
        {
            child_cb.size_mode |= containing_block_context::size_mode_exact_width;
        }
		if (cross_prop.is_predefined())
		{
			child_cb.size_mode |= containing_block_context::size_mode_content;
		}
		else if (!m_container_wm.is_vertical() && cross_prop.units() == css_units_percentage &&
				 self_size.render_block_size().type != containing_block_context::cbc_value_type_auto)
		{
			// A percentage height against a definite container height is a definite cross size.
			// The block size carries the box-sizing offset (as in align_stretch), so it is used as is.
			pixel_t content = cross_prop.calc_percent(self_size.render_block_size().value);
			child_cb.block_size() = content;
			child_cb.render_block_size() = content;
			child_cb.size_mode |= containing_block_context::size_mode_exact_height;
		}
	}

	el->measure(child_cb, fmt_ctx);
	if (!(self_size.size_mode & containing_block_context::size_mode_measure))
	{
		// The inline size is the flex main size by now. Placing with the shrink-to-fit flag still set
		// would skip the text-align of the item's lines (they only align inside an exact width).
		containing_block_context place_cb = child_cb;
		if (!m_container_wm.is_vertical() && el->css().get_writing_mode() == writing_mode_horizontal_tb)
			place_cb.size_mode &= ~containing_block_context::size_mode_content;
		el->place(0, 0, place_cb, fmt_ctx);
	}
}

void litehtml::flex_item_row_direction::align_stretch(flex_line &ln, const containing_block_context &self_size_const,
													  formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	set_cross_position(ln.cross_start);
    const css_length& cross_prop = m_container_wm.get_block_size(el->css());
	if ((cross_prop.is_predefined() && cross_prop.predef() == 0))
	{
        pixel_t new_block_size = ln.cross_size - el->content_offset_block(m_container_wm) + el->box_sizing_block(m_container_wm);
        
        // Use current physical dimensions converted to logical inline size
        satoru::logical_size current_content_size = m_container_wm.to_logical(el->pos().width, el->pos().height);
        pixel_t new_inline_size = current_content_size.inline_size + el->box_sizing_inline(m_container_wm);

        containing_block_context::typed_pixel tp_is(new_inline_size, containing_block_context::cbc_value_type_absolute);
        // A stretched item is a definite size for its percentage children only when the container's own height is definite.
        containing_block_context::typed_pixel tp_bs(new_block_size, containing_block_context::cbc_value_type_absolute);

        containing_block_context cb = m_container_wm.update_logical(self_size, tp_is, tp_bs);
        cb.size_mode = containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height;
        if (self_size_const.height.type == containing_block_context::cbc_value_type_auto)
            cb.size_mode |= containing_block_context::size_mode_cyclic_height;

		if (self_size.size_mode & containing_block_context::size_mode_measure)
		{
			el->measure(cb, fmt_ctx);
		} else
		{
			el->measure(cb, fmt_ctx);
			el->place(el->left(), el->top(), cb, fmt_ctx);
		}
		apply_main_auto_margins();
	}
}

void litehtml::flex_item_row_direction::align_baseline(litehtml::flex_line &ln,
													   const containing_block_context &/*self_size*/,
													   formatting_context */*fmt_ctx*/)
{
	if (align & flex_align_items_last)
	{
		set_cross_position(ln.cross_start + ln.last_baseline.get_offset_from_top(ln.cross_size) - el->get_last_baseline());
	} else
	{
		set_cross_position(ln.cross_start + ln.first_baseline.get_offset_from_top(ln.cross_size) - el->get_first_baseline());
	}
}

litehtml::pixel_t litehtml::flex_item_row_direction::get_el_main_size()
{
	return el->inline_size(m_container_wm);
}

litehtml::pixel_t litehtml::flex_item_row_direction::get_el_cross_size()
{
	return el->block_size(m_container_wm);
}

////////////////////////////////////////////////////////////////////////////////////

void litehtml::flex_item_column_direction::direction_specific_init(const litehtml::containing_block_context &self_size_const,
																   litehtml::formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

    // Map logical margins to auto_margin flags (Main = Block, Cross = Inline)
    const auto& margins = el->css().get_margins();
    if(m_container_wm.block_start(margins).is_predefined()) auto_margin_main_start = 0;
    if(m_container_wm.block_end(margins).is_predefined()) auto_margin_main_end = 0;
    if(m_container_wm.inline_start(margins).is_predefined()) auto_margin_cross_start = true;
    if(m_container_wm.inline_end(margins).is_predefined()) auto_margin_cross_end = true;
	
	// A stretched item's block size is measured at its stretched cross size (the container's width),
	// not as shrink-to-fit content: its percentage-based descendants need that definite width.
	const bool stretch_cross = ((align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal) &&
		!auto_margin_cross_start && !auto_margin_cross_end && !m_container_wm.is_vertical() &&
		m_container_wm.get_inline_size(el->css()).is_predefined() &&
		self_size.render_width.value > 0;
	// A specified width (e.g. `width:100%` on an svg/img) is just as definite: its block size depends on it.
	const css_length& cross_size = m_container_wm.get_inline_size(el->css());
	const bool specified_cross = !m_container_wm.is_vertical() && !cross_size.is_predefined() &&
		!cross_size.is_calc() && self_size.render_width.value > 0;
	auto apply_stretch_width = [&](containing_block_context& cb)
	{
		if (specified_cross)
		{
			cb.width = cross_size.calc_percent(self_size.render_width.value);
			cb.width.type = containing_block_context::cbc_value_type_absolute;
			cb.render_width = cb.width;
			cb.size_mode |= containing_block_context::size_mode_exact_width;
			cb.size_mode &= ~(containing_block_context::size_mode_content | containing_block_context::size_mode_min_content);
			return;
		}
		if (!stretch_cross) return;
		cb.width = self_size.render_width.value - el->content_offset_width() + el->box_sizing_width();
		cb.width.type = containing_block_context::cbc_value_type_absolute;
		cb.render_width = cb.width;
		cb.size_mode |= containing_block_context::size_mode_exact_width;
		cb.size_mode &= ~(containing_block_context::size_mode_content | containing_block_context::size_mode_min_content);
	};

    // Manual branching for min/max
    const css_length& min_size_prop = m_container_wm.is_vertical() ? el->css().get_min_width() : el->css().get_min_height();
    const css_length& max_size_prop = m_container_wm.is_vertical() ? el->css().get_max_width() : el->css().get_max_height();
    const css_length& size_prop = m_container_wm.get_block_size(el->css()); // Main size
    
    pixel_t render_offset = el->render_offset_height();
    if(m_container_wm.is_vertical()) render_offset = el->render_offset_width();

    pixel_t content_offset = el->content_offset_block(m_container_wm);
	pixel_t parent_size = self_size.render_block_size();

	if (min_size_prop.is_predefined())
	{
		if (el->css().get_overflow() == overflow_visible ||
			el->src_el()->css().get_display() == display_webkit_box)
		{
			formatting_context fmt_ctx_copy;
			if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
			int mode = containing_block_context::size_mode_measure;
			bool stretch = (align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal;
			mode |= containing_block_context::size_mode_content;
			
            // Reset both? Original logic: 
            // child_cb.width.type = auto; child_cb.height.type = auto;
            // child_cb.size_mode &= ~exact; size_mode |= mode;
            containing_block_context measure_cb = m_container_wm.update_logical(self_size, std::nullopt, std::nullopt); 
            measure_cb.width.type = containing_block_context::cbc_value_type_auto;
            measure_cb.height.type = containing_block_context::cbc_value_type_auto;
            measure_cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
            measure_cb.size_mode |= mode;
            apply_stretch_width(measure_cb);

			el->measure(measure_cb, fmt_ctx ? &fmt_ctx_copy : nullptr);
			min_main_size = get_el_main_size();
			// Automatic minimum size: the smaller of the content size and a definite specified
			// size. The measured size already honours the item's own height, so take the content
			// size from the extent of its in-flow children (horizontal writing mode only).
			if (!m_container_wm.is_vertical() && !size_prop.is_predefined() &&
				size_prop.units() != css_units_percentage)
			{
				pixel_t content_extent = 0;
				for (const auto& child : el->children())
				{
					auto position = child->src_el()->css().get_position();
					if (position == element_position_absolute || position == element_position_fixed) continue;
					content_extent = std::max(content_extent, child->top() + child->height() + child->get_margins().bottom);
				}
				pixel_t content_main = content_extent + el->content_offset_block(m_container_wm);
				if (content_main < min_main_size) min_main_size = content_main;
			}
			else if (!m_container_wm.is_vertical() && size_prop.units() == css_units_percentage &&
					 self_size.render_height.type != containing_block_context::cbc_value_type_auto)
			{
				// A percentage against a definite container height is a specified size suggestion too.
				pixel_t specified = size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_block(m_container_wm);
				if (specified < min_main_size) min_main_size = specified;
			}
		} else
		{
			min_main_size = render_offset;
		}
	} else
	{
		min_main_size = min_size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_block(m_container_wm);
	}
	if (!max_size_prop.is_predefined())
	{
		max_main_size = max_size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_block(m_container_wm);
	}

	bool flex_basis_predefined = el->css().get_flex_basis().is_predefined();
	int predef = flex_basis_auto;
	if(flex_basis_predefined) predef = el->css().get_flex_basis().predef();
	else if(el->css().get_flex_basis().val() < 0) flex_basis_predefined = true;

	// Fix: If we are measuring the container (intrinsic sizes), we should treat
	// flex-basis as content for growable items or if basis is 0/percentage.
	// CAUTION: Using flex_basis_content instead of flex_basis_max_content so it can wrap appropriately
	// in normal flow.
	if (!flex_basis_predefined && (self_size.size_mode & containing_block_context::size_mode_measure)) {
		if (grow > 0 || el->css().get_flex_basis().units() == css_units_percentage || el->css().get_flex_basis().val() == 0) {
			flex_basis_predefined = true;
			predef = flex_basis_content;
		}
	}

	// A percentage flex-basis (`flex: 1 1` is `1 1 0%`) against an indefinite container height
	// behaves as content.
	if (!flex_basis_predefined && !m_container_wm.is_vertical() &&
		el->css().get_flex_basis().units() == css_units_percentage &&
		self_size.render_height.type == containing_block_context::cbc_value_type_auto)
	{
		flex_basis_predefined = true;
		predef = flex_basis_fit_content;
	}

	if (flex_basis_predefined)
	{
		if(predef == flex_basis_auto && size_prop.is_predefined()) predef = flex_basis_fit_content;
		// A percentage block size against an indefinite container height behaves as auto.
		if(predef == flex_basis_auto && !m_container_wm.is_vertical() &&
		   size_prop.units() == css_units_percentage &&
		   self_size.render_height.type == containing_block_context::cbc_value_type_auto)
		{
			predef = flex_basis_fit_content;
		}
		switch (predef)
		{
			case flex_basis_auto:
				flex_base_size = size_prop.calc_percent(parent_size) + render_offset - el->box_sizing_block(m_container_wm);
				break;
			case flex_basis_content:
			case flex_basis_max_content:
			case flex_basis_fit_content:
				{
					containing_block_context measure_size = self_size;
                    measure_size.width.type = containing_block_context::cbc_value_type_auto;
                    measure_size.height.type = containing_block_context::cbc_value_type_auto;
                    measure_size.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);
					measure_size.size_mode |= containing_block_context::size_mode_measure;
					bool stretch = (align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal;
					measure_size.size_mode |= containing_block_context::size_mode_content;
					apply_stretch_width(measure_size);
					formatting_context fmt_ctx_copy;
					if(fmt_ctx) fmt_ctx_copy = *fmt_ctx;
					el->measure(measure_size, fmt_ctx ? &fmt_ctx_copy : nullptr);
					flex_base_size = get_el_main_size();
				}
				break;
			case flex_basis_min_content:
				flex_base_size = min_main_size;
				break;
			default:
				flex_base_size = 0;
		}
	} else
	{
		flex_base_size = el->css().get_flex_basis().calc_percent(parent_size) + render_offset - el->box_sizing_block(m_container_wm);
	}

	scaled_flex_shrink_factor = (flex_base_size - render_offset) * shrink;
}

void litehtml::flex_item_column_direction::apply_main_auto_margins()
{
    if(!auto_margin_main_start.is_default()) m_container_wm.set_block_start(el->get_margins(), auto_margin_main_start);
    if(!auto_margin_main_end.is_default()) m_container_wm.set_block_end(el->get_margins(), auto_margin_main_end);
}

bool litehtml::flex_item_column_direction::apply_cross_auto_margins(pixel_t cross_size)
{
	if(auto_margin_cross_end || auto_margin_cross_start)
	{
		int margins_num = 0;
		if(auto_margin_cross_end) margins_num++;
		if(auto_margin_cross_start) margins_num++;
		pixel_t margin = (cross_size - get_el_cross_size()) / margins_num;

        if(auto_margin_cross_start) m_container_wm.set_inline_start(el->get_margins(), margin);
        if(auto_margin_cross_end) m_container_wm.set_inline_end(el->get_margins(), margin);

		return true;
	}
	return false;
}

void litehtml::flex_item_column_direction::set_main_position(pixel_t pos)
{
    main_pos = pos;
}

void litehtml::flex_item_column_direction::set_cross_position(pixel_t pos)
{
    cross_pos = pos;
}

void litehtml::flex_item_column_direction::layout_item(litehtml::flex_line &ln,
													   const litehtml::containing_block_context &self_size_const,
													   litehtml::formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	containing_block_context child_cb = self_size;
	child_cb.mode = m_container_wm.mode();
    // Main Axis = Block
    child_cb.block_size() = main_size - el->content_offset_block(m_container_wm) + el->box_sizing_block(m_container_wm);
    child_cb.render_block_size() = child_cb.block_size();

	bool stretch = ((align & 0xFF) == flex_align_items_stretch || (align & 0xFF) == flex_align_items_normal) &&
                   !auto_margin_cross_start && !auto_margin_cross_end;
	const css_length& cross_prop = m_container_wm.get_inline_size(el->css());

	if (stretch && (cross_prop.is_predefined() && cross_prop.predef() == 0))
	{
        // Cross Axis = Inline
        child_cb.inline_size() = ln.cross_size - el->content_offset_inline(m_container_wm) + el->box_sizing_inline(m_container_wm);
        child_cb.render_inline_size() = child_cb.inline_size();
		child_cb.size_mode = containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height;
		if (!m_container_wm.is_vertical() && self_size_const.height.type == containing_block_context::cbc_value_type_auto)
			child_cb.size_mode |= containing_block_context::size_mode_cyclic_height;
	} else {
        child_cb.width.type = containing_block_context::cbc_value_type_auto;
        child_cb.height.type = containing_block_context::cbc_value_type_auto;
        child_cb.size_mode &= ~(containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height);

		if (m_container_wm.is_vertical())
		{
            child_cb.width = main_size - el->content_offset_width() + el->box_sizing_width();
            child_cb.render_width = child_cb.width;
			child_cb.size_mode |= containing_block_context::size_mode_exact_width;
		} else
		{
            child_cb.height = main_size - el->content_offset_height() + el->box_sizing_height();
            child_cb.render_height = child_cb.height;
			child_cb.size_mode |= containing_block_context::size_mode_exact_height;
			// The main size of an item in an auto-height column container is not definite for percentage children.
			if (self_size_const.height.type == containing_block_context::cbc_value_type_auto)
				child_cb.size_mode |= containing_block_context::size_mode_cyclic_height;
		}
		if (cross_prop.is_predefined())
		{
			child_cb.size_mode |= containing_block_context::size_mode_content;
		}
	}

	el->measure(child_cb, fmt_ctx);
	if (!(self_size.size_mode & containing_block_context::size_mode_measure))
	{
		// A shrink-to-fit item has its width by now: place it with that width as an exact one, or the
		// text-align of its lines would be skipped (see the row direction).
		containing_block_context place_cb = child_cb;
		if (!m_container_wm.is_vertical() && el->css().get_writing_mode() == writing_mode_horizontal_tb && cross_prop.is_predefined() && (!stretch || cross_prop.predef() != 0))
		{
			place_cb.width = el->inline_size(m_container_wm) - el->content_offset_inline(m_container_wm) + el->box_sizing_inline(m_container_wm);
			place_cb.width.type = containing_block_context::cbc_value_type_absolute;
			place_cb.render_width = place_cb.width;
			place_cb.size_mode |= containing_block_context::size_mode_exact_width;
			place_cb.size_mode &= ~containing_block_context::size_mode_content;
			// The content was laid out for the shrink-to-fit width before min/max-width clamped it, and
			// percentage widths of the children resolved against that unclamped width.
			el->measure(place_cb, fmt_ctx);
		}
		el->place(0, 0, place_cb, fmt_ctx);
	}
}

void litehtml::flex_item_column_direction::align_stretch(flex_line &ln, const containing_block_context &self_size_const,
													  formatting_context *fmt_ctx)
{
	containing_block_context self_size = self_size_const;
	self_size.width = self_size.render_width;
	self_size.height = self_size.render_height;

	set_cross_position(ln.cross_start);
	const css_length& cross_prop = m_container_wm.get_inline_size(el->css());
	if ((cross_prop.is_predefined() && cross_prop.predef() == 0))
	{
        pixel_t new_inline_size = ln.cross_size - el->content_offset_inline(m_container_wm) + el->box_sizing_inline(m_container_wm);
        
        // Use current physical dimensions converted to logical block size
        satoru::logical_size current_content_size = m_container_wm.to_logical(el->pos().width, el->pos().height);
        pixel_t new_block_size = current_content_size.block_size + el->box_sizing_block(m_container_wm);

        containing_block_context::typed_pixel tp_is(new_inline_size, containing_block_context::cbc_value_type_absolute);
        containing_block_context::typed_pixel tp_bs(new_block_size, containing_block_context::cbc_value_type_absolute);

        containing_block_context cb = m_container_wm.update_logical(self_size, tp_is, tp_bs);
        cb.size_mode = containing_block_context::size_mode_exact_width | containing_block_context::size_mode_exact_height;

		if (self_size.size_mode & containing_block_context::size_mode_measure)
		{
			el->measure(cb, fmt_ctx);
		} else
		{
			el->measure(cb, fmt_ctx);
			el->place(el->left(), el->top(), cb, fmt_ctx);
		}
		apply_main_auto_margins();
	}
}

void litehtml::flex_item_column_direction::align_baseline(litehtml::flex_line &ln,
													   const containing_block_context &self_size,
													   formatting_context *fmt_ctx)
{
	// A column container has no inline baseline: the items sharing it line up their border edges on the
	// start of the line, the widest start margin setting that edge.
	pixel_t shared_margin = 0;
	for (auto& it : ln.items)
	{
		if ((it->align & 0xFF) == flex_align_items_baseline)
			shared_margin = std::max(shared_margin, m_container_wm.inline_start(it->el->get_margins()));
	}
	set_cross_position(ln.cross_start + shared_margin - m_container_wm.inline_start(el->get_margins()));
}

litehtml::pixel_t litehtml::flex_item_column_direction::get_el_main_size()
{
	return el->block_size(m_container_wm);
}

litehtml::pixel_t litehtml::flex_item_column_direction::get_el_cross_size()
{
	return el->inline_size(m_container_wm);
}
