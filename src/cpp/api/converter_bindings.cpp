#include "converter_bindings.h"

using namespace emscripten;

// image-opt版 encode_val の改名移設。converter_api_encode (実在・実働) に接続。
val converter_encode_val(ImageConverterInstance* inst, int format, float quality, int speed,
                         bool animation) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = converter_api_encode(inst, format, quality, speed, animation, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// 画像入力→SVG/PDF (converter instance の decode済み frames[0] を使用)。
// SVG は std::string 返却 (embind が JS 文字列へコピーするため lifetime 安全)。
// PDF は encode_val と同じ typed_memory_view + set_last_output 保持。
std::string converter_encode_svg_val(ImageConverterInstance* inst) {
    if (!inst) return "";
    return inst->encode_svg();
}
val converter_encode_pdf_val(ImageConverterInstance* inst) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = inst->encode_pdf(size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// converter_load_image: C APIは (inst, const uint8_t*, size_t)->success-indicator のため
// JS直結不可。Uint8Array/ArrayBuffer受けのvalラッパ経由で登録し、成否をboolで返す。
// (converter_api_load_image実体はapi/converter_api.cppに存在・実働。MakeWithCopyで同期コピー
// するためvecのlifetime問題なし)
bool converter_load_image_val(ImageConverterInstance* inst, val data) {
    if (!inst || data.isUndefined() || data.isNull()) return false;
    std::vector<uint8_t> vec = val_to_vector(data);
    if (vec.empty()) return false;
    const uint8_t* r = converter_api_load_image(inst, vec.data(), vec.size());
    return r != nullptr;
}
