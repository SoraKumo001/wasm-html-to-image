#ifndef SATORU_TEXT_LAYOUT_H
#define SATORU_TEXT_LAYOUT_H

// P2b: text/ 責務整理 (振る舞い不変)。
//   shaping   : shapeText/shapeAnalyzedText/shapePreparedText (SkShaper経路。本cpp後半)
//   layout    : analyzeText/measureText/ellipsizeText/splitText/balanceText (計測・分割)
//   decoration: text_decoration_renderer (下線等。描画は text_renderer 側から委譲)
//   geometry  : text_geometry (論理→物理座標変換。描画位置計算のみ)
//   unicode   : unicode_service (SkUnicode/libunibreak の窓口。skunicode_satoru の
//               直接利用は unicode_service 経由に限定: SkUnicode実装選択の集約点)
//   tagging   : tagging_context (magic color 埋め込み。renderer 内部利用)
//   types     : text_types (CharFont/MeasureResult/ShapedResult 等の共有型)
// 本クラスは shaping+layout を担当し、描画 (draw) は TextRenderer が担当。

#include <functional>
#include <set>
#include <string>
#include <vector>

#include "bridge/bridge_types.h"
#include "core/text/text_types.h"

class SatoruContext;

namespace satoru {

class TextLayout {
   public:
    static TextAnalysis analyzeText(
        SatoruContext* ctx, const char* text, size_t len, font_info* fi,
        litehtml::writing_mode mode = litehtml::writing_mode_horizontal_tb,
        std::set<char32_t>* usedCodepoints = nullptr, bool computeLineBreaks = true);

    static MeasureResult measureText(
        SatoruContext* ctx, const char* text, font_info* fi,
        litehtml::writing_mode mode = litehtml::writing_mode_horizontal_tb, double maxWidth = -1.0,
        std::set<char32_t>* usedCodepoints = nullptr);

    static std::string ellipsizeText(SatoruContext* ctx, const char* text, font_info* fi,
                                     litehtml::writing_mode mode, double maxWidth,
                                     std::set<char32_t>* usedCodepoints = nullptr);

    static ShapedResult shapeText(
        SatoruContext* ctx, const char* text, size_t len, font_info* fi,
        litehtml::writing_mode mode = litehtml::writing_mode_horizontal_tb,
        std::set<char32_t>* usedCodepoints = nullptr);

    static ShapedResult shapeAnalyzedText(SatoruContext* ctx, const char* text, size_t len,
                                          font_info* fi, litehtml::writing_mode mode,
                                          const TextAnalysis& analysis);

    static ShapedResult shapePreparedText(SatoruContext* ctx, const char* cacheText,
                                          size_t cacheLen, const char* shapeText, size_t shapeLen,
                                          font_info* fi, litehtml::writing_mode mode,
                                          const TextAnalysis& analysis);

    static void splitText(SatoruContext* ctx, const char* text,
                          const std::function<void(const char*)>& onWord,
                          const std::function<void(const char*)>& onSpace);

    static double balanceText(SatoruContext* ctx, const char* text, font_info* fi,
                              litehtml::writing_mode mode, double maxWidth);
};

}  // namespace satoru

#endif  // SATORU_TEXT_LAYOUT_H
