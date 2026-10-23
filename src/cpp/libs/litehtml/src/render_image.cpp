#include "render_image.h"

#include <algorithm>
#include <cstdio>
#include <iostream>

#include "document.h"
#include "types.h"

litehtml::pixel_t litehtml::render_item_image::_measure(
    const containing_block_context& containing_block_size, formatting_context* /*fmt_ctx*/) {
    containing_block_context self_size = m_self_size;

    litehtml::size sz;
    src_el()->get_content_size(sz, containing_block_size.width);

    m_pos.width = 0;
    m_pos.height = 0;

    bool is_content_size =
        (containing_block_size.size_mode & containing_block_context::size_mode_content) != 0;
    bool is_min_content =
        (containing_block_size.size_mode & containing_block_context::size_mode_min_content) != 0;

    // A percentage inline size is cyclic while the containing block is being sized from content
    // (shrink-to-fit / min-content): it contributes 0 to the min-content size instead of falling
    // back to the intrinsic size. This is what lets a flex item shrink below its image's natural
    // width (Chromium: the min-content contribution of a percentage-width replaced element is 0).
    // (a replaced element with a percentage max-width is compressible too: CSS Sizing 5.2.2)
    if (is_min_content && (css().get_width().units() == css_units_percentage ||
                           (css().get_max_width().units() == css_units_percentage && css().get_width().is_predefined()))) {
        m_pos.width = 0;
        m_pos.height = 0;
        src_el()->css_w().line_height_w().computed_value = height();
        return content_offset_width();
    }

    const bool width_is_auto =
        self_size.width.type == containing_block_context::cbc_value_type_auto;
    const bool height_is_auto =
        self_size.height.type == containing_block_context::cbc_value_type_auto;

    if (!width_is_auto) {
        m_pos.width = self_size.render_width;
    }
    if (!height_is_auto) {
        m_pos.height = self_size.render_height;
    }

    // The used ratio for a replaced element: an explicit aspect-ratio replaces the intrinsic
    // ratio, while `aspect-ratio: auto <ratio>` only falls back to the specified ratio when the
    // image has no intrinsic ratio. A ratio of 0 means unknown, so only the intrinsic ratio can
    // be used for the arithmetic below.
    float used_ratio = 0;  // height / width
    const aspect_ratio ar = css().get_aspect_ratio();
    const bool has_intrinsic_ratio = sz.width > 0 && sz.height > 0;
    if (!ar.is_auto() && !(ar.use_intrinsic && has_intrinsic_ratio)) {
        if (ar.width > 0 && ar.height > 0) used_ratio = ar.height / ar.width;
    } else if (has_intrinsic_ratio) {
        used_ratio = (float)sz.height / (float)sz.width;
    }

    if (width_is_auto && height_is_auto && src_el()->is_ratio_only_replaced()) {
        // An aspect ratio but no natural size (CSS 2.1 10.3.2): the width comes from the block-level
        // equation, i.e. the containing block's width. Its min-content contribution is cyclic and
        // counts as 0 (as for a percentage width), except for an absolutely positioned box, which is
        // sized against its own containing block. The max-content (shrink-to-fit) size keeps the
        // fill: the document root is measured in that mode, so it cannot tell a float from a block.
        const bool positioned = css().get_position() == element_position_absolute ||
                                css().get_position() == element_position_fixed;
        // A ratio-only box inside a float / inline-block / absolutely positioned / fit-content ancestor
        // (through auto-width blocks) has no width of its own to contribute: it is 0 wide, as in Chromium.
        auto in_shrink_to_fit = [&]() {
            for (auto p = parent(); p; p = p->parent()) {
                const auto& pc = p->css();
                const auto disp = pc.get_display();
                if (p == parent() && (disp == display_grid || disp == display_inline_grid)) return true;  // a grid sizes its tracks from the item's contribution
                if (pc.get_float() != float_none || disp == display_inline_block || disp == display_inline_flex ||
                    disp == display_inline_grid || disp == display_inline_table)
                    return true;
                if (pc.get_position() == element_position_absolute || pc.get_position() == element_position_fixed)
                    return pc.get_width().is_predefined();
                if (pc.get_width().is_predefined() && pc.get_width().predef() > 0) return true;  // fit-content / max-content / min-content
                if (!pc.get_width().is_predefined()) return false;
                if (disp != display_block && disp != display_inline) return false;  // flex / grid / table: not handled here
            }
            return false;
        };
        if ((is_min_content && !positioned) || (is_content_size && !positioned && in_shrink_to_fit())) {
            m_pos.width = 0;
        } else {
            const pixel_t avail = containing_block_size.render_width.type == containing_block_context::cbc_value_type_auto
                                      ? (pixel_t)containing_block_size.width
                                      : (pixel_t)containing_block_size.render_width;
            m_pos.width = std::max<pixel_t>(0, avail - content_offset_width());
        }
        m_pos.height = used_ratio > 0 ? m_pos.width * used_ratio : sz.height;
    } else if (width_is_auto && height_is_auto) {
        // Both axes auto: the intrinsic inline size, with the used ratio (or the intrinsic ratio
        // when there is no explicit aspect-ratio) deriving the block size.
        m_pos.width = sz.width;
        m_pos.height = used_ratio > 0 ? m_pos.width * used_ratio : sz.height;
    } else if (width_is_auto) {
        if (used_ratio > 0) {
            m_pos.width = m_pos.height / used_ratio;
        } else if (sz.height != 0) {
            m_pos.width = m_pos.height * sz.width / sz.height;
        }
    } else if (height_is_auto) {
        if (used_ratio > 0) {
            m_pos.height = m_pos.width * used_ratio;
        } else if (sz.width != 0) {
            m_pos.height = m_pos.width * sz.height / sz.width;
        }
    }

    // Constraints (preserve the used ratio when it is known)
    if (!css().get_max_width().is_predefined()) {
        pixel_t max_width = src_el()->get_document()->to_pixels(
            css().get_max_width(), css().get_font_metrics(), containing_block_size.width);
        if (m_pos.width > max_width) {
            m_pos.width = max_width;
            if (used_ratio > 0) {
                m_pos.height = m_pos.width * used_ratio;
            } else if (sz.width != 0) {
                m_pos.height = m_pos.width * sz.height / sz.width;
            }
        }
    }
    if (!css().get_max_height().is_predefined()) {
        pixel_t max_height = src_el()->get_document()->to_pixels(
            css().get_max_height(), css().get_font_metrics(), containing_block_size.height);
        if (m_pos.height > max_height) {
            m_pos.height = max_height;
            if (used_ratio > 0) {
                m_pos.width = m_pos.height / used_ratio;
            } else if (sz.height != 0) {
                m_pos.width = m_pos.height * sz.width / sz.height;
            }
        }
    }

    src_el()->css_w().line_height_w().computed_value = height();

    return m_pos.width + content_offset_width();
}

void litehtml::render_item_image::_place(pixel_t x, pixel_t y,
                                         const containing_block_context& /*containing_block_size*/,
                                         formatting_context* /*fmt_ctx*/) {
    m_pos.move_to(x, y);
    m_pos.x += content_offset_left();
    m_pos.y += content_offset_top();
}

litehtml::pixel_t litehtml::render_item_image::calc_max_height(pixel_t image_height,
                                                               pixel_t containing_block_height) {
    document::ptr doc = src_el()->get_document();
    return doc->to_pixels(css().get_max_height(), css().get_font_metrics(),
                          containing_block_height == 0 ? image_height : containing_block_height);
}
