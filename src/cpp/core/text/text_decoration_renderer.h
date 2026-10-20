#ifndef SATORU_TEXT_DECORATION_RENDERER_H
#define SATORU_TEXT_DECORATION_RENDERER_H

// P2b: decoration 担当 (下線/上線/取消線)。計測・ shaping は行わない。
// TextRenderer::drawText からのみ呼ばれる想定。

#include <vector>

#include "bridge/bridge_types.h"
#include "include/core/SkCanvas.h"
#include "libs/litehtml/include/litehtml.h"

namespace satoru {

// Ink geometry of the glyphs of a text run.
// Used by `text-decoration-skip-ink` to find the parts of the decoration line
// that would be covered by the ink of the text.
//   inline_start/inline_end: inline-axis extent of the ink, measured from the
//                             inline start of the text box.
//   block_start/block_end:   block-axis extent of the ink, measured from the
//                             block start of the text box. In a vertical
//                             writing mode the ink of a turned glyph is
//                             rotated by 90 degrees, so the block axis is the
//                             horizontal one.
//   baseline:                block-axis offset of the text baseline.
//   has_baseline:            false when the ink has no block-axis side to
//                             pick (the upright glyphs of a vertical writing
//                             mode), in which case the whole ink counts.
struct DecorationGlyphInk {
    float inline_start = 0;
    float inline_end = 0;
    float block_start = 0;
    float block_end = 0;
    float baseline = 0;
    bool has_baseline = true;
};

class TextDecorationRenderer {
   public:
    static void drawDecoration(SkCanvas* canvas, font_info* fi, const litehtml::position& pos,
                               const litehtml::web_color& color, double finalWidth,
                               litehtml::writing_mode mode,
                               const std::vector<DecorationGlyphInk>& glyph_ink);
};

}  // namespace satoru

#endif  // SATORU_TEXT_DECORATION_RENDERER_H
