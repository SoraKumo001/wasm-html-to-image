#ifndef HTML_TO_IMAGE_APNG_ENCODER_H
#define HTML_TO_IMAGE_APNG_ENCODER_H

// common/apng_encoder: animated PNG (APNG) mux.
//
// Each frame is encoded by the regular PNG encoder and its IDAT payload is re-wrapped as
// `fdAT` chunks behind an `acTL` / `fcTL` pair (PNG spec extension "APNG"). Every frame
// covers the whole canvas with blend_op SOURCE and dispose_op NONE, so no inter-frame
// compositing state is needed.

#include <cstddef>

#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"

namespace html_to_image {

struct ApngFrame {
    SkPixmap pixmap;
    int duration = 0;  // ms
};

//   loop_count : play count. 0 = infinite (APNG `num_plays` semantics).
// Returns nullptr on failure (no frames, size mismatch, encode failure).
sk_sp<SkData> encode_apng(const ApngFrame* frames, size_t count, int loop_count);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_APNG_ENCODER_H
