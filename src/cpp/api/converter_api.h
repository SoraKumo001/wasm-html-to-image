#ifndef HTML_TO_IMAGE_CONVERTER_API_H
#define HTML_TO_IMAGE_CONVERTER_API_H

// api/converter_api: image-opt版を正として移植・改名。
// 正本: `@node-libraries/wasm-image-optimization/src/cpp/api/image_converter_api.h/.cpp`
// 改名: `api_*` → `converter_api_*` (main.cpp の mangle衝突回避方針による)。
// 委譲: decode は `common/image_decoder` (EXIF補正+SVG対応済み)、
// encode 内訳は `common/skia_encode` の dispatcher、thumbhash は
// `common/thumbhash` (skia_encode経由) を利用。クラス・API形状は正本維持。

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "../bridge/bridge_types.h"
#include "../core/image_converter_context.h"
#include "include/core/SkBitmap.h"

struct ConverterImageFrame {
    SkBitmap bitmap;
    int duration = 0;
};

class ImageConverterInstance {
   public:
    ImageConverterContext context;
    std::vector<ConverterImageFrame> frames;
    sk_sp<SkData> raw_data;
    sk_sp<SkData> original_data;
    int original_width = 0;
    int original_height = 0;
    bool original_animation = false;
    std::string original_format;
    bool output_animation = false;
    std::string output_format;

    ImageConverterInstance();
    ~ImageConverterInstance();

    bool load_image(const uint8_t* data, size_t size);
    const uint8_t* encode(RenderFormat format, float quality, int speed, bool animation,
                          int& out_size);
    const uint8_t* encode(const ConverterEncodeOptions& options, int& out_size);
    bool crop(int x, int y, int width, int height);
    bool resize(int width, int height, FitMode fit = FitMode::Contain);

    // Decoded-image -> vector (image-input svg/pdf path).
    // encode_svg: frames[0] を PNG data URL の <image> 一枚で包んだSVG文字列
    // (空文字=失敗)。encode_pdf: frames[0] を等倍1ページに収めたPDFバイト列
    // (encode() と同じ set_last_output 保持。nullptr=失敗)。
    std::string encode_svg();
    const uint8_t* encode_pdf(int& out_size);

    int get_original_width() const;
    int get_original_height() const;
    bool is_original_animation() const;
    std::string get_original_format() const;
    int get_width() const;
    int get_height() const;
    bool is_animation() const;
    std::string get_format() const;
};

ImageConverterInstance* converter_api_create_instance();
void converter_api_destroy_instance(ImageConverterInstance* inst);

const uint8_t* converter_api_load_image(ImageConverterInstance* inst, const uint8_t* data,
                                        size_t size);
const uint8_t* converter_api_encode(ImageConverterInstance* inst, int format, float quality,
                                    int speed, bool animation, int& out_size);
bool converter_api_crop(ImageConverterInstance* inst, int x, int y, int width, int height);
bool converter_api_resize(ImageConverterInstance* inst, int width, int height, int fit = 0);

int converter_api_get_original_width(ImageConverterInstance* inst);
int converter_api_get_original_height(ImageConverterInstance* inst);
bool converter_api_is_original_animation(ImageConverterInstance* inst);
std::string converter_api_get_original_format(ImageConverterInstance* inst);
int converter_api_get_width(ImageConverterInstance* inst);
int converter_api_get_height(ImageConverterInstance* inst);
bool converter_api_is_animation(ImageConverterInstance* inst);
std::string converter_api_get_format(ImageConverterInstance* inst);

void converter_api_set_log_level(int level);

#endif  // HTML_TO_IMAGE_CONVERTER_API_H
