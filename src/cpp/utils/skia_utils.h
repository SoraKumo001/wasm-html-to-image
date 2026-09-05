#ifndef HTML_TO_IMAGE_UTILS_SKIA_UTILS_SHIM_H
#define HTML_TO_IMAGE_UTILS_SKIA_UTILS_SHIM_H

// utils/skia_utils shim: satoru版 `utils/skia_utils.h` と common/skia_utils.h は
// 同一内容 (image_info + clean_font_name/base64/url_decode/make_rrect) のため、
// 多重定義を避けて common 側の宣言を再利用する。定義実体は common/skia_utils.cpp。
// 正本: `satoru/src/cpp/utils/skia_utils.h`

#include "../common/skia_utils.h"

#endif  // HTML_TO_IMAGE_UTILS_SKIA_UTILS_SHIM_H
