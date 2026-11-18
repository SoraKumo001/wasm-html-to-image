#include "canvas_bindings.h"

#include <cstdint>
#include <string>
#include <vector>

#include "converter_api.h"
#include "satoru_bindings.h"

using namespace emscripten;

namespace {

static std::vector<double> val_to_double_vector(val data) {
    if (data.isUndefined() || data.isNull()) return {};
    unsigned len = data["length"].isUndefined() ? 0 : data["length"].as<unsigned>();
    std::vector<double> vec(len);
    if (len > 0) {
        val memoryView = val(typed_memory_view(len, vec.data()));
        memoryView.call<void>("set", data);
    }
    return vec;
}

static std::vector<uint8_t> g_last_image_data;

}  // namespace

bool canvas_resize_val(CanvasInstance* inst, int width, int height) {
    return inst && inst->resize(width, height);
}

int canvas_get_width_val(CanvasInstance* inst) { return inst ? inst->width() : 0; }

int canvas_get_height_val(CanvasInstance* inst) { return inst ? inst->height() : 0; }

bool canvas_exec_batch_val(CanvasInstance* inst, val ops_val, val args_val, val strings_val) {
    if (!inst) return false;
    std::vector<uint8_t> ops = val_to_vector(ops_val);
    if (ops.empty()) return true;
    std::vector<double> args = val_to_double_vector(args_val);
    std::vector<std::string> strings;
    if (!strings_val.isUndefined() && !strings_val.isNull()) {
        strings = vecFromJSArray<std::string>(strings_val);
    }
    return inst->exec_batch(ops.data(), ops.size(), args.data(), args.size(), strings);
}

bool canvas_draw_image_bytes_val(CanvasInstance* inst, val data, double sx, double sy, double sw,
                                 double sh, double dx, double dy, double dw, double dh,
                                 bool has_src_rect) {
    if (!inst || data.isUndefined() || data.isNull()) return false;
    std::vector<uint8_t> vec = val_to_vector(data);
    if (vec.empty()) return false;
    return inst->draw_image_bytes(vec.data(), vec.size(), sx, sy, sw, sh, dx, dy, dw, dh,
                                  has_src_rect);
}

bool canvas_draw_converter_val(CanvasInstance* inst, ImageConverterInstance* src, int frame_index,
                               double sx, double sy, double sw, double sh, double dx, double dy,
                               double dw, double dh, bool has_src_rect) {
    if (!inst || !src) return false;
    return inst->draw_converter(src, frame_index, sx, sy, sw, sh, dx, dy, dw, dh, has_src_rect);
}

bool canvas_draw_canvas_val(CanvasInstance* inst, CanvasInstance* src, double sx, double sy,
                            double sw, double sh, double dx, double dy, double dw, double dh,
                            bool has_src_rect) {
    if (!inst || !src) return false;
    return inst->draw_canvas(src, sx, sy, sw, sh, dx, dy, dw, dh, has_src_rect);
}

val canvas_get_image_data_val(CanvasInstance* inst, int x, int y, int width, int height) {
    if (!inst) return val::null();
    if (!inst->get_image_data(x, y, width, height, g_last_image_data)) return val::null();
    return val(typed_memory_view(g_last_image_data.size(), g_last_image_data.data()));
}

bool canvas_put_image_data_val(CanvasInstance* inst, val rgba_data, int x, int y, int width,
                               int height) {
    if (!inst || rgba_data.isUndefined() || rgba_data.isNull()) return false;
    std::vector<uint8_t> vec = val_to_vector(rgba_data);
    if (vec.empty()) return false;
    return inst->put_image_data(vec.data(), vec.size(), x, y, width, height);
}

bool canvas_to_converter_val(CanvasInstance* inst, ImageConverterInstance* dst) {
    if (!inst || !dst) return false;
    return inst->to_converter(dst);
}

val canvas_encode_val(CanvasInstance* inst, int format, float quality, int speed) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = inst->encode((RenderFormat)format, quality, speed, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}
