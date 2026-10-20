#include "gif_encoder.h"

#include <algorithm>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkImageInfo.h"

namespace html_to_image {
namespace {

struct Rgb {
    int r, g, b;
};

// 5 bits per channel histogram bin index.
inline int bin_of(int r, int g, int b) { return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); }

inline void bin_rgb(int bin, int& r, int& g, int& b) {
    r = (((bin >> 10) & 31) << 3) | 4;
    g = (((bin >> 5) & 31) << 3) | 4;
    b = ((bin & 31) << 3) | 4;
}

std::vector<Rgb> median_cut(const std::vector<uint32_t>& hist, int max_colors) {
    std::vector<std::vector<int>> boxes(1);
    for (int i = 0; i < (int)hist.size(); ++i)
        if (hist[i]) boxes[0].push_back(i);
    if (boxes[0].empty()) return {{0, 0, 0}};

    auto widest_axis = [&](const std::vector<int>& bins, int& axis) {
        int lo[3] = {255, 255, 255}, hi[3] = {0, 0, 0};
        for (int bin : bins) {
            int c[3];
            bin_rgb(bin, c[0], c[1], c[2]);
            for (int k = 0; k < 3; ++k) {
                lo[k] = std::min(lo[k], c[k]);
                hi[k] = std::max(hi[k], c[k]);
            }
        }
        int best = 0, span = hi[0] - lo[0];
        for (int k = 1; k < 3; ++k) {
            if (hi[k] - lo[k] > span) {
                span = hi[k] - lo[k];
                best = k;
            }
        }
        axis = best;
        return span;
    };

    while ((int)boxes.size() < max_colors) {
        // Split the box with the widest color span that still holds >= 2 distinct bins.
        int pick = -1, pick_span = -1, pick_axis = 0;
        for (int i = 0; i < (int)boxes.size(); ++i) {
            if (boxes[i].size() < 2) continue;
            int axis;
            int span = widest_axis(boxes[i], axis);
            if (span > pick_span) {
                pick_span = span;
                pick = i;
                pick_axis = axis;
            }
        }
        if (pick < 0) break;
        std::vector<int>& box = boxes[pick];
        std::sort(box.begin(), box.end(), [&](int a, int b) {
            int ca[3], cb[3];
            bin_rgb(a, ca[0], ca[1], ca[2]);
            bin_rgb(b, cb[0], cb[1], cb[2]);
            return ca[pick_axis] < cb[pick_axis];
        });
        // Split at the population median.
        uint64_t total = 0;
        for (int bin : box) total += hist[bin];
        uint64_t acc = 0;
        size_t cut = 1;
        for (size_t i = 0; i < box.size(); ++i) {
            acc += hist[box[i]];
            if (acc * 2 >= total) {
                cut = std::min(std::max<size_t>(i + 1, 1), box.size() - 1);
                break;
            }
        }
        std::vector<int> other(box.begin() + cut, box.end());
        box.resize(cut);
        boxes.push_back(std::move(other));
    }

    std::vector<Rgb> palette;
    palette.reserve(boxes.size());
    for (const auto& box : boxes) {
        uint64_t sr = 0, sg = 0, sb = 0, n = 0;
        for (int bin : box) {
            int r, g, b;
            bin_rgb(bin, r, g, b);
            uint64_t w = hist[bin];
            sr += r * w;
            sg += g * w;
            sb += b * w;
            n += w;
        }
        if (n == 0) n = 1;
        palette.push_back({(int)(sr / n), (int)(sg / n), (int)(sb / n)});
    }
    return palette;
}

class BitWriter {
public:
    explicit BitWriter(std::vector<uint8_t>& out) : out_(out) {}
    void write(uint32_t code, int bits) {
        acc_ |= (uint64_t)code << nbits_;
        nbits_ += bits;
        while (nbits_ >= 8) {
            block_.push_back((uint8_t)acc_);
            acc_ >>= 8;
            nbits_ -= 8;
            if (block_.size() == 255) flush_block();
        }
    }
    void finish() {
        if (nbits_ > 0) block_.push_back((uint8_t)acc_);
        acc_ = 0;
        nbits_ = 0;
        flush_block();
        out_.push_back(0);  // block terminator
    }

private:
    void flush_block() {
        if (block_.empty()) return;
        out_.push_back((uint8_t)block_.size());
        out_.insert(out_.end(), block_.begin(), block_.end());
        block_.clear();
    }
    std::vector<uint8_t>& out_;
    std::vector<uint8_t> block_;
    uint64_t acc_ = 0;
    int nbits_ = 0;
};

void lzw_encode(std::vector<uint8_t>& out, const std::vector<uint8_t>& indices, int min_code_size) {
    out.push_back((uint8_t)min_code_size);
    BitWriter bw(out);
    const int clear = 1 << min_code_size;
    const int eoi = clear + 1;
    int next = eoi + 1;
    int bits = min_code_size + 1;
    std::unordered_map<uint32_t, uint16_t> dict;
    dict.reserve(8192);

    bw.write(clear, bits);
    if (indices.empty()) {
        bw.write(eoi, bits);
        bw.finish();
        return;
    }
    uint32_t prefix = indices[0];
    for (size_t i = 1; i < indices.size(); ++i) {
        uint32_t c = indices[i];
        uint32_t key = (prefix << 8) | c;
        auto it = dict.find(key);
        if (it != dict.end()) {
            prefix = it->second;
            continue;
        }
        bw.write(prefix, bits);
        if (next < 4096) {
            dict[key] = (uint16_t)next++;
            // The decoder adds its entry one code later, so it widens one step after us.
            if (next - 1 == (1 << bits) && bits < 12) ++bits;
        } else {
            bw.write(clear, bits);
            dict.clear();
            next = eoi + 1;
            bits = min_code_size + 1;
        }
        prefix = c;
    }
    bw.write(prefix, bits);
    bw.write(eoi, bits);
    bw.finish();
}

void put16le(std::vector<uint8_t>& out, int v) {
    out.push_back((uint8_t)(v & 0xFF));
    out.push_back((uint8_t)((v >> 8) & 0xFF));
}

}  // namespace

sk_sp<SkData> encode_gif(const GifFrame* frames, size_t count, int loop_count, uint32_t bgcolor) {
    if (frames == nullptr || count == 0) return nullptr;
    const int width = frames[0].pixmap.width();
    const int height = frames[0].pixmap.height();
    if (width <= 0 || height <= 0 || width > 65535 || height > 65535) return nullptr;

    const int bg_r = (bgcolor >> 16) & 0xFF, bg_g = (bgcolor >> 8) & 0xFF, bg_b = bgcolor & 0xFF;

    // 1) Composite every frame over the background into straight RGB.
    std::vector<std::vector<uint8_t>> rgb(count);
    std::vector<uint32_t> hist(32768, 0);
    for (size_t f = 0; f < count; ++f) {
        if (frames[f].pixmap.width() != width || frames[f].pixmap.height() != height) return nullptr;
        SkBitmap norm;
        if (!norm.tryAllocPixels(SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                                                   kUnpremul_SkAlphaType)) ||
            !frames[f].pixmap.readPixels(norm.pixmap())) {
            return nullptr;
        }
        const uint8_t* src = (const uint8_t*)norm.getPixels();
        const size_t stride = norm.rowBytes();
        rgb[f].resize((size_t)width * height * 3);
        uint8_t* dst = rgb[f].data();
        for (int y = 0; y < height; ++y) {
            const uint8_t* row = src + y * stride;
            for (int x = 0; x < width; ++x, row += 4, dst += 3) {
                int a = row[3];
                dst[0] = (uint8_t)((row[0] * a + bg_r * (255 - a) + 127) / 255);
                dst[1] = (uint8_t)((row[1] * a + bg_g * (255 - a) + 127) / 255);
                dst[2] = (uint8_t)((row[2] * a + bg_b * (255 - a) + 127) / 255);
                hist[bin_of(dst[0], dst[1], dst[2])]++;
            }
        }
    }

    // 2) One global palette for the whole animation.
    std::vector<Rgb> palette = median_cut(hist, 256);
    const int used_colors = (int)palette.size();
    int table_bits = 1;
    while ((1 << table_bits) < used_colors) ++table_bits;
    palette.resize((size_t)1 << table_bits, Rgb{0, 0, 0});

    // 15-bit color -> nearest palette index (lazily filled).
    std::vector<int16_t> lut(32768, -1);
    auto nearest = [&](int r, int g, int b) {
        int bin = bin_of(r, g, b);
        if (lut[bin] >= 0) return (int)lut[bin];
        int br, bg, bb;
        bin_rgb(bin, br, bg, bb);
        int best = 0;
        long best_d = -1;
        for (int i = 0; i < used_colors; ++i) {
            long dr = br - palette[i].r, dg = bg - palette[i].g, db = bb - palette[i].b;
            long d = dr * dr * 2 + dg * dg * 4 + db * db * 3;  // rough perceptual weighting
            if (best_d < 0 || d < best_d) {
                best_d = d;
                best = i;
            }
        }
        lut[bin] = (int16_t)best;
        return best;
    };

    // 3) Header, logical screen, global color table, loop extension.
    std::vector<uint8_t> out = {'G', 'I', 'F', '8', '9', 'a'};
    put16le(out, width);
    put16le(out, height);
    out.push_back((uint8_t)(0x80 | (7 << 4) | (table_bits - 1)));
    out.push_back(0);  // background color index
    out.push_back(0);  // pixel aspect ratio
    for (const Rgb& c : palette) {
        out.push_back((uint8_t)c.r);
        out.push_back((uint8_t)c.g);
        out.push_back((uint8_t)c.b);
    }
    if (count > 1 && loop_count != 1) {
        const char app[] = "NETSCAPE2.0";
        out.push_back(0x21);
        out.push_back(0xFF);
        out.push_back(11);
        out.insert(out.end(), app, app + 11);
        out.push_back(3);
        out.push_back(1);
        put16le(out, loop_count <= 0 ? 0 : loop_count - 1);
        out.push_back(0);
    }

    // 4) Frames: Floyd-Steinberg dithered indices, LZW compressed.
    const int min_code_size = std::max(2, table_bits);
    const size_t row_stride = ((size_t)width + 2) * 3;
    std::vector<int> err(row_stride * 2);
    std::vector<uint8_t> indices((size_t)width * height);
    for (size_t f = 0; f < count; ++f) {
        std::fill(err.begin(), err.end(), 0);
        const uint8_t* px = rgb[f].data();
        for (int y = 0; y < height; ++y) {
            int* cur = &err[(size_t)(y & 1) * row_stride];
            int* nxt = &err[(size_t)((y + 1) & 1) * row_stride];
            for (int x = 0; x < width; ++x) {
                const uint8_t* p = px + ((size_t)y * width + x) * 3;
                int v[3];
                for (int k = 0; k < 3; ++k)
                    v[k] = std::clamp(p[k] + cur[(x + 1) * 3 + k] / 16, 0, 255);
                int idx = nearest(v[0], v[1], v[2]);
                indices[(size_t)y * width + x] = (uint8_t)idx;
                const Rgb& c = palette[idx];
                int e[3] = {v[0] - c.r, v[1] - c.g, v[2] - c.b};
                for (int k = 0; k < 3; ++k) {
                    cur[(x + 2) * 3 + k] += e[k] * 7;
                    nxt[x * 3 + k] += e[k] * 3;
                    nxt[(x + 1) * 3 + k] += e[k] * 5;
                    nxt[(x + 2) * 3 + k] += e[k];
                }
            }
            std::fill(cur, cur + row_stride, 0);
        }

        // Graphic control extension: disposal 1 (leave in place), delay in 1/100 s.
        int delay = std::max(2, (frames[f].duration + 5) / 10);
        out.push_back(0x21);
        out.push_back(0xF9);
        out.push_back(4);
        out.push_back(0x04);
        put16le(out, std::min(delay, 65535));
        out.push_back(0);
        out.push_back(0);
        // Image descriptor (no local color table).
        out.push_back(0x2C);
        put16le(out, 0);
        put16le(out, 0);
        put16le(out, width);
        put16le(out, height);
        out.push_back(0);
        lzw_encode(out, indices, min_code_size);
    }
    out.push_back(0x3B);
    return SkData::MakeWithCopy(out.data(), out.size());
}

}  // namespace html_to_image
