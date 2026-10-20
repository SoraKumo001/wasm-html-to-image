#ifndef HTML_TO_IMAGE_RENDER_FORMAT_H
#define HTML_TO_IMAGE_RENDER_FORMAT_H

// Bridge base: log level, render formats, encode options.
// Split from `bridge_types.h` (content verbatim).

#include <cstdint>
#include <string>

enum class LogLevel { None = 0, Error = 1, Warning = 2, Info = 3, Debug = 4 };

// image-opt版の全値域を採用 (satoru側 0..3 と互換: SVG=0 PNG=1 WebP=2 PDF=3)
enum class RenderFormat {
    None = -1,
    SVG = 0,
    PNG = 1,
    WebP = 2,
    PDF = 3,
    JPEG = 4,
    AVIF = 5,
    RAW = 6,
    ThumbHash = 7,
    JXL = 8,
    APNG = 9,
    GIF = 10
};

// image-opt版 FitMode を共通化 (satoru側 RenderOptions::fitType 0/1/2 と同義)
enum class FitMode { Contain = 0, Cover = 1, Fill = 2 };

// image-opt側エンコード引数 (format, quality, speed, animation) の構造体版。
struct ConverterEncodeOptions {
    RenderFormat format = RenderFormat::PNG;
    float quality = 85.0f;
    int speed = 6;
    bool animation = false;
    FitMode fit = FitMode::Contain;
    // animated WebP / APNG / GIF の再生回数 (libwebp の anim_params.loop_count 相当)。
    // 0 = 無限回 (Skia `SkWebpEncoder::EncodeAnimated` 従来値)。
    int animation_loop = 0;
    // animated WebP の canvas背景色 (GIF では透過部分の合成色) (libwebp の anim_params.bgcolor, 0xAARRGGBB)。
    // 既定は libwebp と同じ不透明白 (0xFFFFFFFF)。
    uint32_t animation_bgcolor = 0xFFFFFFFFu;
};

void html_to_image_log(LogLevel level, const char* message);
// 旧 image-opt名の互換宣言 (現状の参照は html_to_image_log 側のみ。削除は別途判断)。
void image_converter_log(LogLevel level, const char* message);

#endif  // HTML_TO_IMAGE_RENDER_FORMAT_H
