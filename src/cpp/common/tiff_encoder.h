#ifndef HTML_TO_IMAGE_TIFF_ENCODER_H
#define HTML_TO_IMAGE_TIFF_ENCODER_H

// common/tiff_encoder: baseline little-endian TIFF writer (8 bits per sample, Deflate +
// horizontal predictor, strips of about 128 KiB).
//
//   RGB  : RGBA, straight (unassociated) alpha, PhotometricInterpretation = RGB.
//   CMYK : PhotometricInterpretation = Separated (InkSet = CMYK), no alpha. Transparent
//          pixels are composited over `bgcolor` first, then converted with common/cmyk.h.
//
// The resolution tags carry `dpi` (CSS px are 96 per inch).

#include <cstdint>

#include "cmyk.h"
#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"

namespace html_to_image {

//   bgcolor : 0xAARRGGBB; used by the CMYK path only (the RGB path keeps the alpha channel).
// Returns nullptr on failure.
sk_sp<SkData> encode_tiff(const SkPixmap& pixmap, ColorSpace color_space, uint32_t bgcolor,
                          int dpi = 96);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_TIFF_ENCODER_H
