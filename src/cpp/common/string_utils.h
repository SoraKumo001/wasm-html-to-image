#ifndef HTML_TO_IMAGE_COMMON_STRING_UTILS_H
#define HTML_TO_IMAGE_COMMON_STRING_UTILS_H

// common/string_utils: 汎用文字列処理の1本化 (header-only, inlineのみ)。
// 由来: `api/satoru_api.cpp` の匿名namespace (`json_escape` / `codepoints_to_utf8`)
// を逐語移植。header-only のため CMakeLists.txt (target_sources明示列挙) の変更は不要。
// 新規throwなし・返却値不変。ログを発しない純粋関数のため logging.h の [CODE] 規約の対象外。

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

namespace html_to_image {

inline std::string json_escape(const std::string& s) {
    std::string result;
    result.reserve(s.size() + 16);
    for (unsigned char c : s) {
        if (c == '"')
            result += "\\\"";
        else if (c == '\\')
            result += "\\\\";
        else if (c <= 0x1f) {
            char buf[7];
            snprintf(buf, sizeof(buf), "\\u%04x", c);
            result += buf;
        } else {
            result += (char)c;
        }
    }
    return result;
}

inline std::string codepoints_to_utf8(std::vector<char32_t>& cps) {
    std::sort(cps.begin(), cps.end());
    cps.erase(std::unique(cps.begin(), cps.end()), cps.end());
    std::string res;
    res.reserve(cps.size() * 3);
    for (char32_t cp : cps) {
        if (cp <= 0x7F) {
            res += (char)cp;
        } else if (cp <= 0x7FF) {
            res += (char)(0xC0 | (cp >> 6));
            res += (char)(0x80 | (cp & 0x3F));
        } else if (cp <= 0xFFFF) {
            res += (char)(0xE0 | (cp >> 12));
            res += (char)(0x80 | ((cp >> 6) & 0x3F));
            res += (char)(0x80 | (cp & 0x3F));
        } else if (cp <= 0x10FFFF) {
            res += (char)(0xF0 | (cp >> 18));
            res += (char)(0x80 | ((cp >> 12) & 0x3F));
            res += (char)(0x80 | ((cp >> 6) & 0x3F));
            res += (char)(0x80 | (cp & 0x3F));
        }
    }
    return res;
}

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_COMMON_STRING_UTILS_H
