#ifndef HTML_TO_IMAGE_CANVAS_BINDINGS_H
#define HTML_TO_IMAGE_CANVAS_BINDINGS_H

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "canvas_api.h"

class ImageConverterInstance;

bool canvas_resize_val(CanvasInstance* inst, int width, int height);
int canvas_get_width_val(CanvasInstance* inst);
int canvas_get_height_val(CanvasInstance* inst);
bool canvas_exec_batch_val(CanvasInstance* inst, emscripten::val ops_val,
                           emscripten::val args_val, emscripten::val strings_val);
bool canvas_draw_image_bytes_val(CanvasInstance* inst, emscripten::val data, double sx, double sy,
                                 double sw, double sh, double dx, double dy, double dw, double dh,
                                 bool has_src_rect);
bool canvas_draw_converter_val(CanvasInstance* inst, ImageConverterInstance* src, int frame_index,
                               double sx, double sy, double sw, double sh, double dx, double dy,
                               double dw, double dh, bool has_src_rect);
bool canvas_draw_canvas_val(CanvasInstance* inst, CanvasInstance* src, double sx, double sy,
                            double sw, double sh, double dx, double dy, double dw, double dh,
                            bool has_src_rect);
emscripten::val canvas_get_image_data_val(CanvasInstance* inst, int x, int y, int width,
                                          int height);
bool canvas_put_image_data_val(CanvasInstance* inst, emscripten::val rgba_data, int x, int y,
                               int width, int height);
bool canvas_to_converter_val(CanvasInstance* inst, ImageConverterInstance* dst);
emscripten::val canvas_encode_val(CanvasInstance* inst, int format, float quality, int speed);

#endif  // HTML_TO_IMAGE_CANVAS_BINDINGS_H
