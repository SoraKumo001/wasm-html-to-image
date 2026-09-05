#ifndef HTML_TO_IMAGE_SKIA_UTILS_H
#define HTML_TO_IMAGE_SKIA_UTILS_H

// common/skia_utils: satoru版supersetを正として1本化。
// 正本: `satoru/src/cpp/utils/skia_utils.h/.cpp`
// 不採用: image-opt版 `utils/skia_utils.h` (base64_encode/decode + url_decode のみで、
//          下記の clean_font_name / make_rrect を欠くサブセットのため)。
// image-opt版にあって satoru版にない関数は存在しない (superset関係) ので、
// satoru版の持ち込みで欠落なし。

#include <cstdint>
#include <string>
#include <vector>

#include "include/core/SkImage.h"
#include "include/core/SkRRect.h"
#include "include/core/SkRefCnt.h"
#include "litehtml.h"

struct image_info {
    int width;
    int height;
    std::string data_url;
    sk_sp<SkImage> skImage;
};

std::string clean_font_name(const char* name);
std::string base64_encode(const uint8_t* data, size_t len);
std::vector<uint8_t> base64_decode(const std::string& in);
std::string url_decode(const std::string& in);

SkRRect make_rrect(const litehtml::position& pos, const litehtml::border_radiuses& radius);

#endif  // HTML_TO_IMAGE_SKIA_UTILS_H
