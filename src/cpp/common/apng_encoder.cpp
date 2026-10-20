#include "apng_encoder.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkImageInfo.h"
#include "skia_encode.h"

namespace html_to_image {
namespace {

const std::array<uint32_t, 256>& crc_table() {
    static const std::array<uint32_t, 256> table = [] {
        std::array<uint32_t, 256> t{};
        for (uint32_t n = 0; n < 256; ++n) {
            uint32_t c = n;
            for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }();
    return table;
}

uint32_t crc32_update(const uint8_t* data, size_t len, uint32_t crc) {
    const auto& t = crc_table();
    for (size_t i = 0; i < len; ++i) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    return crc;
}

void put32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((uint8_t)(v >> 24));
    out.push_back((uint8_t)(v >> 16));
    out.push_back((uint8_t)(v >> 8));
    out.push_back((uint8_t)v);
}

void put16(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((uint8_t)(v >> 8));
    out.push_back((uint8_t)v);
}

uint32_t get32(const uint8_t* p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

void write_chunk(std::vector<uint8_t>& out, const char type[4], const std::vector<uint8_t>& data) {
    put32(out, (uint32_t)data.size());
    size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    uint32_t crc = crc32_update(out.data() + start, out.size() - start, 0xFFFFFFFFu) ^ 0xFFFFFFFFu;
    put32(out, crc);
}

struct PngParts {
    std::vector<uint8_t> ihdr;  // 13 bytes
    std::vector<uint8_t> idat;  // concatenated IDAT payloads
};

bool split_png(const uint8_t* data, size_t size, PngParts& parts) {
    static const uint8_t sig[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    if (size < 8 || std::memcmp(data, sig, 8) != 0) return false;
    size_t pos = 8;
    while (pos + 12 <= size) {
        uint32_t len = get32(data + pos);
        const uint8_t* type = data + pos + 4;
        if (pos + 12 + (size_t)len > size) return false;
        const uint8_t* body = data + pos + 8;
        if (std::memcmp(type, "IHDR", 4) == 0) {
            parts.ihdr.assign(body, body + len);
        } else if (std::memcmp(type, "IDAT", 4) == 0) {
            parts.idat.insert(parts.idat.end(), body, body + len);
        } else if (std::memcmp(type, "IEND", 4) == 0) {
            break;
        }
        pos += 12 + (size_t)len;
    }
    return parts.ihdr.size() == 13 && !parts.idat.empty();
}

}  // namespace

sk_sp<SkData> encode_apng(const ApngFrame* frames, size_t count, int loop_count) {
    if (frames == nullptr || count == 0) return nullptr;
    const int width = frames[0].pixmap.width();
    const int height = frames[0].pixmap.height();
    if (width <= 0 || height <= 0) return nullptr;

    std::vector<PngParts> parts(count);
    for (size_t i = 0; i < count; ++i) {
        if (frames[i].pixmap.width() != width || frames[i].pixmap.height() != height) return nullptr;
        // Normalize to straight RGBA8888 so every frame shares one IHDR (color type 6).
        SkBitmap norm;
        if (!norm.tryAllocPixels(SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                                                   kUnpremul_SkAlphaType)) ||
            !frames[i].pixmap.readPixels(norm.pixmap())) {
            return nullptr;
        }
        sk_sp<SkData> png = encode_png(norm.pixmap());
        if (!png || !split_png(png->bytes(), png->size(), parts[i])) return nullptr;
        if (i > 0 && parts[i].ihdr != parts[0].ihdr) return nullptr;
    }

    std::vector<uint8_t> out = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    write_chunk(out, "IHDR", parts[0].ihdr);

    std::vector<uint8_t> actl;
    put32(actl, (uint32_t)count);
    put32(actl, (uint32_t)std::max(0, loop_count));
    write_chunk(out, "acTL", actl);

    uint32_t seq = 0;
    for (size_t i = 0; i < count; ++i) {
        std::vector<uint8_t> fctl;
        put32(fctl, seq++);
        put32(fctl, (uint32_t)width);
        put32(fctl, (uint32_t)height);
        put32(fctl, 0);  // x_offset
        put32(fctl, 0);  // y_offset
        int ms = frames[i].duration > 0 ? frames[i].duration : 10;
        put16(fctl, (uint32_t)std::min(ms, 65535));
        put16(fctl, 1000);  // delay_den: delay is in ms
        fctl.push_back(0);  // dispose_op NONE
        fctl.push_back(0);  // blend_op SOURCE
        write_chunk(out, "fcTL", fctl);

        if (i == 0) {
            write_chunk(out, "IDAT", parts[i].idat);
        } else {
            std::vector<uint8_t> fdat;
            put32(fdat, seq++);
            fdat.insert(fdat.end(), parts[i].idat.begin(), parts[i].idat.end());
            write_chunk(out, "fdAT", fdat);
        }
    }
    write_chunk(out, "IEND", {});
    return SkData::MakeWithCopy(out.data(), out.size());
}

}  // namespace html_to_image
