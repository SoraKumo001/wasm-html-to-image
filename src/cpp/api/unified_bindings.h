#ifndef HTML_TO_IMAGE_UNIFIED_BINDINGS_H
#define HTML_TO_IMAGE_UNIFIED_BINDINGS_H

// Embind glue for the unified `html_to_image` call.
// Moved verbatim from `src/cpp/main.cpp` (behavior unchanged).
//
// 所有権注記: `g_last_unified_bytes` が返却viewの backing bytes を所有する。
// embind の `typed_memory_view` は WASM メモリへのview (コピーなし) を返すため、
// 一時インスタンス破棄後も有効化する目的で `std::vector` へコピー保持する。
// JS側は受領後に速やかにコピーすること (後続呼出しで上書きされる)。

#include <cstdint>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "../bridge/bridge_types.h"

class SatoruInstance;
class ImageConverterInstance;

emscripten::val html_to_image_val(emscripten::val htmls, int width, int height, int format,
                                  emscripten::val options_val, float quality, int speed,
                                  bool animation);

// HTML -> bitmap -> converter instance, with no PNG round trip. Renders with the
// satoru instance state (resolved fonts/images/css) and installs the bitmap as the
// converter's single frame, ready for `converter_encode`. Returns false on failure.
bool satoru_render_to_converter_val(SatoruInstance* satoru, ImageConverterInstance* converter,
                                    emscripten::val htmls, int width, int height,
                                    emscripten::val options_val);

// Animated (opacity / transform / color) HTML -> converter frames, additive:
// appends one frame per sampled style value without touching any existing
// frames.
//
// The animation is defined in the document itself: a `@keyframes <name>`
// block carrying `opacity`, `transform` (translate/rotate/scale only),
// `color` or `background-color` stops, bound to an element via
// `animation-name: <name>` (or the `animation` shorthand / inline style).
// `duration_ms`/`fps` drive the sampler (fixed interval + boundary snap);
// the loop is fixed to infinite.
//
// Frames are deduped at the style-value level (an unchanged opacity merges
// its duration into the previous frame) and capped by
// `k_max_animation_frames` plus `k_max_animation_total_pixel_bytes`.
// Returns the number of frames appended (0 on failure/no animation).
int satoru_render_animation_to_converter_val(SatoruInstance* satoru, ImageConverterInstance* converter,
                                             emscripten::val htmls, int width, int height,
                                             emscripten::val options_val, int duration_ms, int fps);

#endif  // HTML_TO_IMAGE_UNIFIED_BINDINGS_H
