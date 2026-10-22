#include "pdf_cmyk.h"

#include <zlib.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "cmyk.h"
#include "include/codec/SkCodec.h"
#include "include/codec/SkJpegDecoder.h"
#include "include/core/SkImageInfo.h"

namespace html_to_image {
namespace {

struct PdfObject {
    int number = 0;
    std::string dict;    // text of "<< ... >>", or the raw body of a non-dictionary object
    bool is_dict = false;
    bool has_stream = false;
    std::string stream;  // raw (still encoded) stream bytes
};

bool is_ws(char c) { return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == '\0'; }

bool is_delim(char c) {
    return c == '(' || c == ')' || c == '<' || c == '>' || c == '[' || c == ']' || c == '{' ||
           c == '}' || c == '/' || c == '%';
}

// Position just after the string literal that starts at `i` (a '(').
size_t skip_string(const std::string& s, size_t i) {
    int depth = 0;
    for (; i < s.size(); ++i) {
        if (s[i] == '\\') {
            ++i;
        } else if (s[i] == '(') {
            ++depth;
        } else if (s[i] == ')') {
            if (--depth == 0) return i + 1;
        }
    }
    return s.size();
}

// Position just after the dictionary that starts at `i` ("<<"), or npos.
size_t skip_dict(const std::string& s, size_t i) {
    int depth = 0;
    while (i + 1 < s.size()) {
        if (s[i] == '(') {
            i = skip_string(s, i);
        } else if (s[i] == '<' && s[i + 1] == '<') {
            ++depth;
            i += 2;
        } else if (s[i] == '>' && s[i + 1] == '>') {
            --depth;
            i += 2;
            if (depth == 0) return i;
        } else {
            ++i;
        }
    }
    return std::string::npos;
}

bool read_int_key(const std::string& dict, const char* key, long& out) {
    size_t p = dict.find(key);
    if (p == std::string::npos) return false;
    p += std::strlen(key);
    while (p < dict.size() && is_ws(dict[p])) ++p;
    char* end = nullptr;
    out = std::strtol(dict.c_str() + p, &end, 10);
    if (end == dict.c_str() + p) return false;
    // A reference ("N 0 R") is not a direct value.
    size_t q = (size_t)(end - dict.c_str());
    while (q < dict.size() && is_ws(dict[q])) ++q;
    if (q < dict.size() && std::isdigit((unsigned char)dict[q])) return false;
    return true;
}

void replace_all(std::string& s, const std::string& from, const std::string& to) {
    size_t p = 0;
    while ((p = s.find(from, p)) != std::string::npos) {
        s.replace(p, from.size(), to);
        p += to.size();
    }
}

void set_length(std::string& dict, size_t length) {
    size_t p = dict.find("/Length ");
    if (p == std::string::npos) {
        dict.insert(dict.size() - 2, " /Length " + std::to_string(length));
        return;
    }
    size_t b = p + 8, e = b;
    while (e < dict.size() && std::isdigit((unsigned char)dict[e])) ++e;
    dict.replace(b, e - b, std::to_string(length));
}

// ---- parsing --------------------------------------------------------------------------------

bool parse_pdf(const std::string& in, std::string& header, std::map<int, PdfObject>& objects,
               std::string& trailer) {
    // Header: everything before the first "N 0 obj".
    size_t first = std::string::npos;
    for (size_t p = 0; p < in.size(); ++p) {
        if ((p == 0 || in[p - 1] == '\n' || in[p - 1] == '\r') && std::isdigit((unsigned char)in[p])) {
            size_t q = p;
            while (q < in.size() && std::isdigit((unsigned char)in[q])) ++q;
            if (in.compare(q, 6, " 0 obj") == 0) {
                first = p;
                break;
            }
        }
    }
    if (first == std::string::npos) return false;
    header = in.substr(0, first);

    size_t pos = first;
    while (pos < in.size()) {
        while (pos < in.size() && is_ws(in[pos])) ++pos;
        if (!std::isdigit((unsigned char)in[pos])) break;  // "xref"
        char* end = nullptr;
        const long number = std::strtol(in.c_str() + pos, &end, 10);
        pos = (size_t)(end - in.c_str());
        if (in.compare(pos, 6, " 0 obj") != 0) return false;
        pos += 6;
        while (pos < in.size() && is_ws(in[pos])) ++pos;

        PdfObject obj;
        obj.number = (int)number;
        if (in.compare(pos, 2, "<<") == 0) {
            const size_t e = skip_dict(in, pos);
            if (e == std::string::npos) return false;
            obj.dict = in.substr(pos, e - pos);
            obj.is_dict = true;
            pos = e;
            size_t q = pos;
            while (q < in.size() && is_ws(in[q])) ++q;
            if (in.compare(q, 6, "stream") == 0) {
                long length = 0;
                if (!read_int_key(obj.dict, "/Length", length) || length < 0) return false;
                q += 6;
                if (in[q] == '\r') ++q;
                if (in[q] == '\n') ++q;
                if (q + (size_t)length > in.size()) return false;
                obj.has_stream = true;
                obj.stream = in.substr(q, (size_t)length);
                pos = q + (size_t)length;
                while (pos < in.size() && is_ws(in[pos])) ++pos;
                if (in.compare(pos, 9, "endstream") != 0) return false;
                pos += 9;
            }
        } else {
            const size_t e = in.find("endobj", pos);
            if (e == std::string::npos) return false;
            obj.dict = in.substr(pos, e - pos);
            pos = e;
        }
        while (pos < in.size() && is_ws(in[pos])) ++pos;
        if (in.compare(pos, 6, "endobj") != 0) return false;
        pos += 6;
        objects[obj.number] = std::move(obj);
    }

    const size_t t = in.find("trailer", pos);
    if (t == std::string::npos) return false;
    const size_t td = in.find("<<", t);
    if (td == std::string::npos) return false;
    const size_t te = skip_dict(in, td);
    if (te == std::string::npos) return false;
    trailer = in.substr(td, te - td);
    return !objects.empty();
}

// ---- flate helpers --------------------------------------------------------------------------

bool inflate_all(const std::string& src, std::string& out) {
    z_stream zs{};
    if (inflateInit(&zs) != Z_OK) return false;
    zs.next_in = (Bytef*)src.data();
    zs.avail_in = (uInt)src.size();
    char buf[16384];
    int rc;
    do {
        zs.next_out = (Bytef*)buf;
        zs.avail_out = sizeof(buf);
        rc = inflate(&zs, Z_NO_FLUSH);
        if (rc != Z_OK && rc != Z_STREAM_END) {
            inflateEnd(&zs);
            return false;
        }
        out.append(buf, sizeof(buf) - zs.avail_out);
    } while (rc != Z_STREAM_END);
    inflateEnd(&zs);
    return true;
}

bool deflate_all(const std::string& src, std::string& out) {
    uLongf bound = compressBound((uLong)src.size());
    out.resize(bound);
    if (compress2((Bytef*)&out[0], &bound, (const Bytef*)src.data(), (uLong)src.size(), 6) != Z_OK) {
        return false;
    }
    out.resize(bound);
    return true;
}

// ---- content stream colour operators --------------------------------------------------------

std::string format_unit(float v) {
    char b[16];
    std::snprintf(b, sizeof(b), "%.4f", v < 0.f ? 0.f : (v > 1.f ? 1.f : v));
    std::string s = b;
    while (!s.empty() && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
    return s.empty() ? "0" : s;
}

bool is_number_token(const std::string& t) {
    if (t.empty()) return false;
    size_t i = (t[0] == '+' || t[0] == '-') ? 1 : 0;
    bool digit = false;
    for (; i < t.size(); ++i) {
        if (std::isdigit((unsigned char)t[i])) digit = true;
        else if (t[i] != '.') return false;
    }
    return digit;
}

// Returns false when the stream holds something this pass does not rewrite safely (an inline
// image), so the caller can reject the whole conversion instead of corrupting the output.
bool convert_content(const std::string& in, std::string& out) {
    std::vector<std::string> pending;  // operands since the previous operator
    auto flush_pending = [&]() {
        for (const std::string& t : pending) {
            out += t;
            out += ' ';
        }
        pending.clear();
    };
    size_t i = 0;
    while (i < in.size()) {
        const char c = in[i];
        if (is_ws(c)) {
            ++i;
        } else if (c == '%') {
            while (i < in.size() && in[i] != '\n' && in[i] != '\r') ++i;
        } else if (c == '(') {
            const size_t e = skip_string(in, i);
            pending.push_back(in.substr(i, e - i));
            i = e;
        } else if (c == '<' && i + 1 < in.size() && in[i + 1] == '<') {
            pending.push_back("<<");
            i += 2;
        } else if (c == '>' && i + 1 < in.size() && in[i + 1] == '>') {
            pending.push_back(">>");
            i += 2;
        } else if (c == '<') {
            size_t e = in.find('>', i);
            if (e == std::string::npos) return false;
            pending.push_back(in.substr(i, e + 1 - i));
            i = e + 1;
        } else if (c == '[' || c == ']' || c == '{' || c == '}') {
            pending.push_back(std::string(1, c));
            ++i;
        } else if (c == '/') {
            size_t e = i + 1;
            while (e < in.size() && !is_ws(in[e]) && !is_delim(in[e])) ++e;
            pending.push_back(in.substr(i, e - i));
            i = e;
        } else {
            size_t e = i;
            while (e < in.size() && !is_ws(in[e]) && !is_delim(in[e])) ++e;
            if (e == i) {  // stray ')' or similar
                ++i;
                continue;
            }
            const std::string tok = in.substr(i, e - i);
            i = e;
            if (is_number_token(tok) || tok == "true" || tok == "false" || tok == "null") {
                pending.push_back(tok);
                continue;
            }
            // An operator.
            if (tok == "BI" || tok == "ID") return false;
            if ((tok == "rg" || tok == "RG") && pending.size() >= 3 &&
                is_number_token(pending[pending.size() - 1]) &&
                is_number_token(pending[pending.size() - 2]) &&
                is_number_token(pending[pending.size() - 3])) {
                const float r = (float)std::atof(pending[pending.size() - 3].c_str());
                const float g = (float)std::atof(pending[pending.size() - 2].c_str());
                const float b = (float)std::atof(pending[pending.size() - 1].c_str());
                pending.resize(pending.size() - 3);
                flush_pending();
                const Cmyk k = rgb_to_cmyk(std::min(std::max(r, 0.f), 1.f), std::min(std::max(g, 0.f), 1.f),
                                           std::min(std::max(b, 0.f), 1.f));
                out += format_unit(k.c) + ' ' + format_unit(k.m) + ' ' + format_unit(k.y) + ' ' +
                       format_unit(k.k) + (tok == "rg" ? " k\n" : " K\n");
                continue;
            }
            flush_pending();
            out += tok;
            out += '\n';
        }
    }
    flush_pending();
    return true;
}

// ---- images ---------------------------------------------------------------------------------

bool rgb_to_cmyk_pixels(const uint8_t* rgb, size_t pixels, std::string& out) {
    out.resize(pixels * 4);
    for (size_t i = 0; i < pixels; ++i) {
        const Cmyk c = rgb_to_cmyk(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]);
        out[4 * i] = (char)unit_to_byte(c.c);
        out[4 * i + 1] = (char)unit_to_byte(c.m);
        out[4 * i + 2] = (char)unit_to_byte(c.y);
        out[4 * i + 3] = (char)unit_to_byte(c.k);
    }
    return true;
}

// Rewrites a DeviceRGB image object in place. Returns false on an unsupported variant.
bool convert_image(PdfObject& obj) {
    long w = 0, h = 0, bpc = 0;
    if (!read_int_key(obj.dict, "/Width", w) || !read_int_key(obj.dict, "/Height", h) ||
        !read_int_key(obj.dict, "/BitsPerComponent", bpc) || w <= 0 || h <= 0 || bpc != 8) {
        return false;
    }
    if (obj.dict.find("/DecodeParms") != std::string::npos || obj.dict.find("/Decode ") != std::string::npos ||
        obj.dict.find("/Mask") != std::string::npos) {
        return false;
    }
    const size_t pixels = (size_t)w * (size_t)h;
    std::string rgb;
    if (obj.dict.find("/DCTDecode") != std::string::npos) {
        auto data = SkData::MakeWithCopy(obj.stream.data(), obj.stream.size());
        std::unique_ptr<SkCodec> codec = SkJpegDecoder::Decode(data, nullptr, nullptr);
        if (!codec || codec->dimensions().width() != w || codec->dimensions().height() != h) return false;
        std::string rgba(pixels * 4, '\0');
        const SkImageInfo info = SkImageInfo::Make((int)w, (int)h, kRGBA_8888_SkColorType, kOpaque_SkAlphaType);
        if (codec->getPixels(info, &rgba[0], (size_t)w * 4) != SkCodec::kSuccess) return false;
        rgb.resize(pixels * 3);
        for (size_t i = 0; i < pixels; ++i) {
            rgb[3 * i] = rgba[4 * i];
            rgb[3 * i + 1] = rgba[4 * i + 1];
            rgb[3 * i + 2] = rgba[4 * i + 2];
        }
        replace_all(obj.dict, "/Filter /DCTDecode", "/Filter /FlateDecode");
        replace_all(obj.dict, "/ColorTransform 0", "");
        replace_all(obj.dict, "/ColorTransform 1", "");
    } else if (obj.dict.find("/FlateDecode") != std::string::npos) {
        if (!inflate_all(obj.stream, rgb)) return false;
    } else if (obj.dict.find("/Filter") == std::string::npos) {
        rgb = obj.stream;
        obj.dict.insert(obj.dict.size() - 2, " /Filter /FlateDecode");
    } else {
        return false;
    }
    if (rgb.size() != pixels * 3) return false;
    std::string cmyk, packed;
    rgb_to_cmyk_pixels((const uint8_t*)rgb.data(), pixels, cmyk);
    if (!deflate_all(cmyk, packed)) return false;
    // "/ColorSpace /DeviceRGB" or "/ColorSpace [/ICCBased N 0 R]" -> DeviceCMYK.
    const size_t cs = obj.dict.find("/ColorSpace");
    size_t cs_end = cs + 11;
    while (cs_end < obj.dict.size() && is_ws(obj.dict[cs_end])) ++cs_end;
    if (obj.dict[cs_end] == '[') {
        cs_end = obj.dict.find(']', cs_end) + 1;
    } else {
        ++cs_end;  // the leading '/' of the name
        while (cs_end < obj.dict.size() && !is_ws(obj.dict[cs_end]) && !is_delim(obj.dict[cs_end])) ++cs_end;
    }
    obj.dict.replace(cs, cs_end - cs, "/ColorSpace /DeviceCMYK");
    obj.stream = std::move(packed);
    set_length(obj.dict, obj.stream.size());
    return true;
}

bool is_content_stream(const PdfObject& obj) {
    if (!obj.has_stream) return false;
    const std::string& d = obj.dict;
    if (d.find("/Subtype /Image") != std::string::npos) return false;
    // Font programs, ICC profiles and the like: opaque data, never colour operators.
    if (d.find("/Length1") != std::string::npos || d.find("/N ") != std::string::npos) return false;
    if (d.find("/Subtype /Type1C") != std::string::npos ||
        d.find("/Subtype /CIDFontType0C") != std::string::npos ||
        d.find("/Subtype /OpenType") != std::string::npos) {
        return false;
    }
    return true;
}

}  // namespace

sk_sp<SkData> pdf_to_cmyk(const SkData& pdf) {
    const std::string in((const char*)pdf.data(), pdf.size());
    std::string header, trailer;
    std::map<int, PdfObject> objects;
    if (!parse_pdf(in, header, objects, trailer)) return nullptr;

    // An ICCBased space with three components is an RGB image (sRGB as written by Skia); it is
    // converted like DeviceRGB. Gray / CMYK profiles are left alone.
    auto is_rgb_space = [&](const std::string& dict) {
        if (dict.find("/ColorSpace /DeviceRGB") != std::string::npos) return true;
        const size_t p = dict.find("/ICCBased ");
        if (p == std::string::npos) return false;
        const int ref = std::atoi(dict.c_str() + p + 10);
        auto it = objects.find(ref);
        if (it == objects.end()) return false;
        long n = 0;
        return read_int_key(it->second.dict, "/N", n) && n == 3;
    };

    for (auto& [number, obj] : objects) {
        (void)number;
        if (obj.is_dict) replace_all(obj.dict, "/CS /DeviceRGB", "/CS /DeviceCMYK");
        if (!obj.has_stream) continue;
        if (obj.dict.find("/Subtype /Image") != std::string::npos) {
            if (is_rgb_space(obj.dict) && !convert_image(obj)) return nullptr;
            continue;
        }
        if (!is_content_stream(obj)) continue;
        const bool flate = obj.dict.find("/FlateDecode") != std::string::npos;
        if (!flate && obj.dict.find("/Filter") != std::string::npos) continue;  // not text we can read
        std::string plain, converted, packed;
        if (flate) {
            if (!inflate_all(obj.stream, plain)) return nullptr;
        } else {
            plain = obj.stream;
        }
        if (!convert_content(plain, converted)) return nullptr;
        if (flate) {
            if (!deflate_all(converted, packed)) return nullptr;
            obj.stream = std::move(packed);
        } else {
            obj.stream = std::move(converted);
        }
        set_length(obj.dict, obj.stream.size());
    }

    // Fail closed: an RGB space this pass did not rewrite (a shading, a pattern colour space, ...)
    // would leave a "CMYK" file that still carries RGB, so report an error instead.
    for (const auto& [number, obj] : objects) {
        (void)number;
        if (obj.dict.find("/DeviceRGB") != std::string::npos ||
            obj.dict.find("/CalRGB") != std::string::npos || is_rgb_space(obj.dict)) {
            return nullptr;
        }
    }

    std::string out = header;
    int max_number = 0;
    std::map<int, size_t> offsets;
    for (auto& [number, obj] : objects) {
        max_number = std::max(max_number, number);
        offsets[number] = out.size();
        out += std::to_string(number) + " 0 obj\n" + obj.dict;
        if (obj.has_stream) {
            out += "\nstream\n";
            out += obj.stream;
            out += "\nendstream";
        }
        out += "\nendobj\n";
    }
    const size_t xref_pos = out.size();
    out += "xref\n0 " + std::to_string(max_number + 1) + "\n0000000000 65535 f \n";
    for (int n = 1; n <= max_number; ++n) {
        auto it = offsets.find(n);
        if (it == offsets.end()) {
            out += "0000000000 65535 f \n";
        } else {
            char b[32];
            std::snprintf(b, sizeof(b), "%010zu 00000 n \n", it->second);
            out += b;
        }
    }
    out += "trailer\n" + trailer + "\nstartxref\n" + std::to_string(xref_pos) + "\n%%EOF\n";
    return SkData::MakeWithCopy(out.data(), out.size());
}

}  // namespace html_to_image
