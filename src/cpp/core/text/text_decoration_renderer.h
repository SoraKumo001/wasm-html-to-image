#ifndef SATORU_TEXT_DECORATION_RENDERER_H
#define SATORU_TEXT_DECORATION_RENDERER_H

// P2b: decoration 担当 (下線/上線/取消線)。計測・ shaping は行わない。
// TextRenderer::drawText からのみ呼ばれる想定。

#include "bridge/bridge_types.h"
#include "include/core/SkCanvas.h"
#include "libs/litehtml/include/litehtml.h"

namespace satoru {

class TextDecorationRenderer {
   public:
    static void drawDecoration(SkCanvas* canvas, font_info* fi, const litehtml::position& pos,
                               const litehtml::web_color& color, double finalWidth,
                               litehtml::writing_mode mode);
};

}  // namespace satoru

#endif  // SATORU_TEXT_DECORATION_RENDERER_H
