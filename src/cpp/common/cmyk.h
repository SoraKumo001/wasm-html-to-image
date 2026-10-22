#ifndef HTML_TO_IMAGE_CMYK_H
#define HTML_TO_IMAGE_CMYK_H

// common/cmyk: the one sRGB -> CMYK conversion shared by the TIFF and PDF encoders.
//
// This is the plain device conversion (no ICC profile): K = 1 - max(R,G,B), then
// C/M/Y are what is left of each channel once K is removed. White maps to 0,0,0,0 and
// black to 0,0,0,1 (pure K, no rich black), so text stays a single plate on press.
// Saturated screen colours fall outside a press gamut; a print shop's profile
// conversion is the place to adjust them.

#include <algorithm>
#include <cstdint>

namespace html_to_image {

struct Cmyk {
    float c, m, y, k;  // 0..1
};

inline Cmyk rgb_to_cmyk(float r, float g, float b) {  // 0..1 in
    const float k = 1.0f - std::max({r, g, b});
    if (k >= 1.0f) return {0.f, 0.f, 0.f, 1.0f};
    const float inv = 1.0f / (1.0f - k);
    return {(1.0f - r - k) * inv, (1.0f - g - k) * inv, (1.0f - b - k) * inv, k};
}

inline Cmyk rgb_to_cmyk(uint8_t r, uint8_t g, uint8_t b) {
    return rgb_to_cmyk(r / 255.0f, g / 255.0f, b / 255.0f);
}

inline uint8_t unit_to_byte(float v) {
    const float s = v * 255.0f + 0.5f;
    return (uint8_t)(s < 0.f ? 0.f : (s > 255.f ? 255.f : s));
}

// Output color space of a print-oriented encoder (TIFF / PDF).
enum class ColorSpace { SRGB = 0, CMYK = 1 };

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_CMYK_H
