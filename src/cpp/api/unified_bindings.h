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

emscripten::val html_to_image_val(emscripten::val htmls, int width, int height, int format,
                                  emscripten::val options_val, float quality, int speed,
                                  bool animation);

#endif  // HTML_TO_IMAGE_UNIFIED_BINDINGS_H
