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
//                             origin of the text run (the run's inline offset).
//   ink_top/ink_bottom:      vertical extent of the ink, relative to the
//                             baseline of the run (negative = above).
//   baseline:                offset of the run's baseline from the top of the
//                             text box.
struct DecorationGlyphInk {
    float inline_start = 0;
    float inline_end = 0;
    float ink_top = 0;
    float ink_bottom = 0;
    float baseline = 0;
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
