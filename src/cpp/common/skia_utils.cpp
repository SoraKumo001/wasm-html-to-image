#include "skia_utils.h"

#include <algorithm>
#include <cmath>

#include "include/core/SkPathBuilder.h"

// satoru版 `utils/skia_utils.cpp` の逐語移植 (superset側を正とする)。
// image-opt版に clean_font_name / make_rrect は存在しない。

std::string clean_font_name(const char* name) {
    if (!name) return "";
    std::string s = name;
    std::string result;
    for (char c : s) {
        if (c != '\'' && c != '\"' && c != ' ' && c != '\\') {
            result += c;
        }
    }
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

std::string base64_encode(const uint8_t* data, size_t len) {
    std::string out;
    const char* chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int val = 0, valb = -6;
    for (size_t i = 0; i < len; i++) {
        val = (val << 8) + data[i];
        valb += 8;
        while (valb >= 0) {
            out.push_back(chars[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    // valb in {-4, -2} here: 2 or 4 leftover bits, left-aligned into the final sextet.
    if (valb > -6) out.push_back(chars[(val << -valb) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

std::vector<uint8_t> base64_decode(const std::string& in) {
    std::vector<uint8_t> out;
    static const std::vector<int> T = [] {
        std::vector<int> t(256, -1);
        const char* chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < 64; i++) t[(unsigned char)chars[i]] = i;
        return t;
    }();

    int val = 0, valb = -8;
    for (unsigned char c : in) {
        if (T[c] == -1) continue;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(uint8_t((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

std::string url_decode(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%') {
            if (i + 2 < in.size()) {
                int hex = 0;
                for (int j = 1; j <= 2; ++j) {
                    hex <<= 4;
                    if (in[i + j] >= '0' && in[i + j] <= '9')
                        hex += in[i + j] - '0';
                    else if (in[i + j] >= 'a' && in[i + j] <= 'f')
                        hex += in[i + j] - 'a' + 10;
                    else if (in[i + j] >= 'A' && in[i + j] <= 'F')
                        hex += in[i + j] - 'A' + 10;
                }
                out.push_back((char)hex);
                i += 2;
            }
        } else if (in[i] == '+') {
            out.push_back(' ');
        } else {
            out.push_back(in[i]);
        }
    }
    return out;
}

SkRRect make_rrect(const litehtml::position& pos, const litehtml::border_radiuses& radius) {
    SkRect rect = SkRect::MakeXYWH((float)pos.x, (float)pos.y, (float)pos.width, (float)pos.height);
    SkVector rad[4] = {{(float)radius.top_left_x, (float)radius.top_left_y},
                       {(float)radius.top_right_x, (float)radius.top_right_y},
                       {(float)radius.bottom_right_x, (float)radius.bottom_right_y},
                       {(float)radius.bottom_left_x, (float)radius.bottom_left_y}};
    SkRRect rrect;
    rrect.setRectRadii(rect, rad);
    return rrect;
}

SkPath make_shape_path(const litehtml::position& pos, const litehtml::border_radiuses& radius) {
    if (!radius.has_corner_shape()) return SkPath::RRect(make_rrect(pos, radius));

    const float x = (float)pos.x, y = (float)pos.y, w = (float)pos.width, h = (float)pos.height;
    // Per corner (clockwise from top-left): corner point P and the vectors a (P -> where the
    // path arrives) / b (P -> where it leaves) whose lengths are the corner radii.
    struct Corner {
        SkPoint p, a, b;
        int shape;
    };
    const float rx[4] = {(float)radius.top_left_x, (float)radius.top_right_x,
                         (float)radius.bottom_right_x, (float)radius.bottom_left_x};
    const float ry[4] = {(float)radius.top_left_y, (float)radius.top_right_y,
                         (float)radius.bottom_right_y, (float)radius.bottom_left_y};
    const Corner corners[4] = {
        {{x, y}, {0, ry[0]}, {rx[0], 0}, radius.shape[0]},
        {{x + w, y}, {-rx[1], 0}, {0, ry[1]}, radius.shape[1]},
        {{x + w, y + h}, {0, -ry[2]}, {-rx[2], 0}, radius.shape[2]},
        {{x, y + h}, {rx[3], 0}, {0, -ry[3]}, radius.shape[3]},
    };

    SkPathBuilder pb;
    const float k_half_sqrt2 = 0.70710678f;
    for (int i = 0; i < 4; i++) {
        const Corner& c = corners[i];
        const SkPoint start = c.p + c.a;
        const SkPoint end = c.p + c.b;
        const SkPoint center = c.p + c.a + c.b;  // inner corner of the radius box
        if (i == 0) {
            pb.moveTo(start);
        } else {
            pb.lineTo(start);
        }
        const bool flat = (c.a.fX == 0 && c.a.fY == 0) || (c.b.fX == 0 && c.b.fY == 0);
        if (flat) {
            pb.lineTo(c.p);
            continue;
        }
        switch (c.shape) {
            case litehtml::corner_shape_scoop:
                pb.conicTo(center, end, k_half_sqrt2);
                break;
            case litehtml::corner_shape_bevel:
                pb.lineTo(end);
                break;
            case litehtml::corner_shape_notch:
                pb.lineTo(center);
                pb.lineTo(end);
                break;
            case litehtml::corner_shape_squircle: {
                // Superellipse with exponent 4 (CSS `squircle` = superellipse(2)).
                const int steps = 24;
                for (int s = 1; s <= steps; s++) {
                    float t = (float)s / steps * 1.5707963f;
                    float cs = std::pow(std::cos(t), 0.5f);
                    float sn = std::pow(std::sin(t), 0.5f);
                    pb.lineTo(center - c.b * cs - c.a * sn);
                }
                break;
            }
            case litehtml::corner_shape_square:
                pb.lineTo(c.p);
                pb.lineTo(end);
                break;
            default:  // round
                pb.conicTo(c.p, end, k_half_sqrt2);
                break;
        }
    }
    pb.close();
    return pb.detach();
}

