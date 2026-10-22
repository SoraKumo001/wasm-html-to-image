#include "tiff_encoder.h"

#include <zlib.h>

#include <algorithm>
#include <cstring>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkImageInfo.h"

namespace html_to_image {
namespace {

constexpr size_t k_strip_target_bytes = 128 * 1024;

void put16(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((uint8_t)v);
    out.push_back((uint8_t)(v >> 8));
}

void put32(std::vector<uint8_t>& out, uint32_t v) {
    put16(out, v & 0xFFFF);
    put16(out, v >> 16);
}

struct Entry {
    uint16_t tag;
    uint16_t type;  // 3 = SHORT, 4 = LONG, 5 = RATIONAL
    uint32_t count;
    uint32_t value;  // inline value, or the offset of the out-of-line data
};

constexpr uint16_t k_short = 3, k_long = 4, k_rational = 5;

bool deflate_strip(const uint8_t* src, size_t size, std::vector<uint8_t>& out) {
    uLongf bound = compressBound((uLong)size);
    const size_t base = out.size();
    out.resize(base + bound);
    if (compress2(out.data() + base, &bound, src, (uLong)size, 6) != Z_OK) return false;
    out.resize(base + bound);
    return true;
}

}  // namespace

sk_sp<SkData> encode_tiff(const SkPixmap& pixmap, ColorSpace color_space, uint32_t bgcolor, int dpi) {
    const int width = pixmap.width();
    const int height = pixmap.height();
    if (width <= 0 || height <= 0) return nullptr;
    const bool cmyk = color_space == ColorSpace::CMYK;
    const int spp = 4;  // RGBA or CMYK

    // Premultiplied RGBA8888 for the CMYK path (composited over the background), straight
    // alpha for the RGB path (what TIFF's ExtraSamples = 2 expects).
    SkBitmap rgba;
    const SkAlphaType alpha_type = cmyk ? kPremul_SkAlphaType : kUnpremul_SkAlphaType;
    if (!rgba.tryAllocPixels(SkImageInfo::Make(width, height, kRGBA_8888_SkColorType, alpha_type))) {
        return nullptr;
    }
    if (!pixmap.readPixels(rgba.pixmap())) return nullptr;

    const size_t row_bytes = (size_t)width * spp;
    const int rows_per_strip = (int)std::max<size_t>(1, k_strip_target_bytes / row_bytes);
    const int strip_count = (height + rows_per_strip - 1) / rows_per_strip;

    const int bg_r = (bgcolor >> 16) & 0xFF, bg_g = (bgcolor >> 8) & 0xFF, bg_b = bgcolor & 0xFF;

    std::vector<uint8_t> out;
    out.reserve((size_t)width * height / 2 + 1024);
    out.push_back('I');
    out.push_back('I');
    put16(out, 42);
    put32(out, 0);  // IFD offset, patched below

    std::vector<uint32_t> strip_offsets, strip_sizes;
    std::vector<uint8_t> strip;
    for (int s = 0; s < strip_count; ++s) {
        const int y0 = s * rows_per_strip;
        const int rows = std::min(rows_per_strip, height - y0);
        strip.assign((size_t)rows * row_bytes, 0);
        for (int y = 0; y < rows; ++y) {
            const uint8_t* src = (const uint8_t*)rgba.getAddr(0, y0 + y);
            uint8_t* dst = strip.data() + (size_t)y * row_bytes;
            if (cmyk) {
                for (int x = 0; x < width; ++x) {
                    const int a = src[4 * x + 3];
                    // Premultiplied colour + the background through the remaining coverage.
                    const int r = std::min(255, src[4 * x] + (bg_r * (255 - a) + 127) / 255);
                    const int g = std::min(255, src[4 * x + 1] + (bg_g * (255 - a) + 127) / 255);
                    const int b = std::min(255, src[4 * x + 2] + (bg_b * (255 - a) + 127) / 255);
                    const Cmyk c = rgb_to_cmyk((uint8_t)r, (uint8_t)g, (uint8_t)b);
                    dst[4 * x] = unit_to_byte(c.c);
                    dst[4 * x + 1] = unit_to_byte(c.m);
                    dst[4 * x + 2] = unit_to_byte(c.y);
                    dst[4 * x + 3] = unit_to_byte(c.k);
                }
            } else {
                std::memcpy(dst, src, row_bytes);
            }
            // Horizontal predictor (Predictor = 2): each sample minus the one to its left.
            for (int i = (width - 1) * spp + spp - 1; i >= spp; --i) dst[i] = (uint8_t)(dst[i] - dst[i - spp]);
        }
        strip_offsets.push_back((uint32_t)out.size());
        if (!deflate_strip(strip.data(), strip.size(), out)) return nullptr;
        strip_sizes.push_back((uint32_t)out.size() - strip_offsets.back());
        if (out.size() & 1) out.push_back(0);  // keep the following data word-aligned
    }
    if (out.size() > 0xFFFFFFF0u) return nullptr;  // classic TIFF: 32-bit offsets

    // Out-of-line values.
    auto here = [&]() { return (uint32_t)out.size(); };
    const uint32_t bits_off = here();
    for (int i = 0; i < spp; ++i) put16(out, 8);
    uint32_t offsets_off = 0, sizes_off = 0;
    if (strip_count > 1) {
        offsets_off = here();
        for (uint32_t v : strip_offsets) put32(out, v);
        sizes_off = here();
        for (uint32_t v : strip_sizes) put32(out, v);
    }
    const uint32_t res_off = here();
    put32(out, (uint32_t)dpi);
    put32(out, 1);

    std::vector<Entry> entries = {
        {256, k_long, 1, (uint32_t)width},
        {257, k_long, 1, (uint32_t)height},
        {258, k_short, (uint32_t)spp, bits_off},
        {259, k_short, 1, 8},  // Deflate (Adobe)
        {262, k_short, 1, cmyk ? 5u : 2u},
        {273, k_long, (uint32_t)strip_count, strip_count > 1 ? offsets_off : strip_offsets[0]},
        {277, k_short, 1, (uint32_t)spp},
        {278, k_long, 1, (uint32_t)rows_per_strip},
        {279, k_long, (uint32_t)strip_count, strip_count > 1 ? sizes_off : strip_sizes[0]},
        {282, k_rational, 1, res_off},
        {283, k_rational, 1, res_off},
        {284, k_short, 1, 1},  // chunky
        {296, k_short, 1, 2},  // inch
        {317, k_short, 1, 2},  // horizontal predictor
    };
    if (cmyk) {
        entries.push_back({332, k_short, 1, 1});  // InkSet: CMYK
    } else {
        entries.push_back({338, k_short, 1, 2});  // ExtraSamples: unassociated alpha
    }
    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) { return a.tag < b.tag; });

    const uint32_t ifd_off = here();
    put16(out, (uint32_t)entries.size());
    for (const Entry& e : entries) {
        put16(out, e.tag);
        put16(out, e.type);
        put32(out, e.count);
        if (e.type == k_short && e.count == 1) {
            put16(out, e.value);
            put16(out, 0);
        } else {
            put32(out, e.value);
        }
    }
    put32(out, 0);  // no next IFD

    out[4] = (uint8_t)ifd_off;
    out[5] = (uint8_t)(ifd_off >> 8);
    out[6] = (uint8_t)(ifd_off >> 16);
    out[7] = (uint8_t)(ifd_off >> 24);
    return SkData::MakeWithCopy(out.data(), out.size());
}

}  // namespace html_to_image
