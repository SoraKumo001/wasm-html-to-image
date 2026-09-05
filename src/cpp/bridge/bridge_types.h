#ifndef HTML_TO_IMAGE_BRIDGE_TYPES_H
#define HTML_TO_IMAGE_BRIDGE_TYPES_H

// Unified bridge types for the single-WASM build (aggregator; split from the
// former monolith, content moved verbatim):
//  - `render_format.h`: LogLevel + RenderFormat (image-opt全値域) + FitMode +
//    ConverterEncodeOptions + log decls.
//  - `satoru_options.h`: SatoruRenderOptions (HTML描画用).
//  - `draw_tags.h`: satoru描画系の共有構造体 (font/shadow/gradient/filter系)。
// NOTE: 旧名互換 alias `using RenderOptions = SatoruRenderOptions;` は削除済み。
// 使用箇所は `SatoruRenderOptions` に置換した。

#include "draw_tags.h"
#include "render_format.h"
#include "satoru_options.h"

#endif  // HTML_TO_IMAGE_BRIDGE_TYPES_H
