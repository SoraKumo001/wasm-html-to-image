#ifndef HTML_TO_IMAGE_CONVERTER_BINDINGS_H
#define HTML_TO_IMAGE_CONVERTER_BINDINGS_H

// Embind glue for the converter side (image load/encode).
// Moved verbatim from `src/cpp/main.cpp` (behavior unchanged).

#include <cstdint>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "converter_api.h"
#include "satoru_bindings.h"

emscripten::val converter_encode_val(ImageConverterInstance* inst, int format, float quality,
                                     int speed, bool animation);
std::string converter_encode_svg_val(ImageConverterInstance* inst);
emscripten::val converter_encode_pdf_val(ImageConverterInstance* inst);
bool converter_load_image_val(ImageConverterInstance* inst, emscripten::val data);

#endif  // HTML_TO_IMAGE_CONVERTER_BINDINGS_H
