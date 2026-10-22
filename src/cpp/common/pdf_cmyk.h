#ifndef HTML_TO_IMAGE_PDF_CMYK_H
#define HTML_TO_IMAGE_PDF_CMYK_H

// common/pdf_cmyk: rewrite a Skia-generated PDF so that every colour is DeviceCMYK.
//
// Skia's PDF backend only knows RGB. This pass re-writes the finished file:
//   - content / pattern / form / Type3 glyph streams: `r g b rg` / `RG`  ->  `c m y k k` / `K`
//     (DeviceGray stays gray, which is valid in a CMYK document),
//   - image XObjects in DeviceRGB (Flate or DCT)  ->  Flate DeviceCMYK pixels,
//   - transparency groups with `/CS /DeviceRGB`   ->  `/CS /DeviceCMYK`.
// The objects are re-numbered 1:1 and a fresh classic xref table is written. The conversion
// is the device formula of common/cmyk.h (no ICC profile).
//
// Only the structure Skia writes is understood (direct /Length, classic xref, no object
// streams). Returns nullptr when the input is not of that shape or a stream cannot be decoded.

#include "include/core/SkData.h"

namespace html_to_image {

sk_sp<SkData> pdf_to_cmyk(const SkData& pdf);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_PDF_CMYK_H
