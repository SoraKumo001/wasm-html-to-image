#ifndef HTML_TO_IMAGE_SATORU_BINDINGS_H
#define HTML_TO_IMAGE_SATORU_BINDINGS_H

// Embind glue for the satoru side (HTML render + resource discovery).
// Moved verbatim from `src/cpp/main.cpp` (behavior unchanged).
// Shared helpers (`val_to_vector`, `val_to_html_vector`,
// `parse_satoru_options`) also serve `converter_bindings.cpp` and
// `unified_bindings.cpp`.

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "../bridge/bridge_types.h"
#include "satoru_api.h"

std::vector<uint8_t> val_to_vector(emscripten::val data);
void parse_satoru_options(SatoruRenderOptions& options, emscripten::val options_val);
std::vector<std::string> val_to_html_vector(emscripten::val htmls);

emscripten::val satoru_render_val(SatoruInstance* inst, emscripten::val htmls, int width,
                                  int height, int format, emscripten::val options_val);
void satoru_set_font_map_val(SatoruInstance* inst, emscripten::val fontMap);
void satoru_collect_resources_val(SatoruInstance* inst, std::string html, int width, int height,
                                  int mediaType);
emscripten::val satoru_get_pending_resources_val(SatoruInstance* inst);
void satoru_add_resource_val(SatoruInstance* inst, std::string url, int type,
                             emscripten::val data);
void satoru_load_font_val(SatoruInstance* inst, std::string name, emscripten::val data);
void satoru_load_fallback_font_val(SatoruInstance* inst, emscripten::val data);

#endif  // HTML_TO_IMAGE_SATORU_BINDINGS_H
