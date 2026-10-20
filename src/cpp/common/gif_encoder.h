#ifndef HTML_TO_IMAGE_GIF_ENCODER_H
#define HTML_TO_IMAGE_GIF_ENCODER_H

// common/gif_encoder: GIF89a encoder (median-cut palette, Floyd-Steinberg dithering, LZW).
//
// GIF only has 1-bit transparency, so every frame is composited over `bgcolor` first and
// the output is fully opaque. One global palette (<= 256 colors) is derived from all frames.

#include <cstddef>
#include <cstdint>

#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"

namespace html_to_image {

struct GifFrame {
    SkPixmap pixmap;
    int duration = 0;  // ms
};

//   loop_count : play count. 0 = infinite; 1 = play once (no NETSCAPE extension).
//   bgcolor    : 0xAARRGGBB; transparent pixels are composited over its RGB.
// A single frame produces a still GIF. Returns nullptr on failure.
sk_sp<SkData> encode_gif(const GifFrame* frames, size_t count, int loop_count, uint32_t bgcolor);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_GIF_ENCODER_H
