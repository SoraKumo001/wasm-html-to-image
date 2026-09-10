// tests/cpp/test_string_utils.cpp — string_utils.h のホスト単体テスト (P5)
// 方式: 外部依存なしの最小ランナー (assert相当の自前CHECK + main集計 + ctest登録)。
// 対象: src/cpp/common/string_utils.h の json_escape / codepoints_to_utf8 の正常系。
// 前提: 同ヘッダは標準ライブラリのみ (Skia/Emscripten依存なし) のためホストで直接コンパイル可。

#include <cstdio>
#include <string>
#include <vector>

#include "common/string_utils.h"

namespace {

int g_pass = 0;
int g_fail = 0;

std::string to_hex(const std::string& s) {
    static const char* kHex = "0123456789abcdef";
    std::string out;
    out.reserve(s.size() * 2);
    for (unsigned char c : s) {
        out += kHex[c >> 4];
        out += kHex[c & 0x0f];
    }
    return out;
}

void expect_eq(const std::string& actual, const std::string& expected, const char* name) {
    if (actual == expected) {
        ++g_pass;
        std::printf("PASS %s\n", name);
    } else {
        ++g_fail;
        std::printf("FAIL %s\n  expected(hex): %s\n  actual(hex):   %s\n", name,
                    to_hex(expected).c_str(), to_hex(actual).c_str());
    }
}

}  // namespace

int main() {
    using html_to_image::codepoints_to_utf8;
    using html_to_image::json_escape;

    // --- json_escape: 通常文字は不変 ---
    expect_eq(json_escape(""), "", "json_escape/empty");
    expect_eq(json_escape("hello"), "hello", "json_escape/plain");
    expect_eq(json_escape("0129 AZ az"), "0129 AZ az", "json_escape/alnum_space");

    // --- json_escape: 引用符・バックスラッシュ ---
    expect_eq(json_escape("a\"b"), "a\\\"b", "json_escape/quote");
    expect_eq(json_escape("a\\b"), "a\\\\b", "json_escape/backslash");
    expect_eq(json_escape("\"\\"), "\\\"\\\\", "json_escape/quote_backslash_only");

    // --- json_escape: 制御文字は \\uXXXX (小文字16進・4桁ゼロ埋め) ---
    expect_eq(json_escape("\n"), "\\u000a", "json_escape/newline");
    expect_eq(json_escape("\t"), "\\u0009", "json_escape/tab");
    expect_eq(json_escape(std::string("\x1f", 1)), "\\u001f", "json_escape/0x1f");
    expect_eq(json_escape(std::string("\x00", 1)), "\\u0000", "json_escape/0x00");
    expect_eq(json_escape("a\nb"), "a\\u000ab", "json_escape/mixed");

    // --- json_escape: 境界値 (0x20以上・0x7F・0x80以上は不変素通し) ---
    expect_eq(json_escape(" "), " ", "json_escape/0x20_space");
    expect_eq(json_escape("\x7f"), "\x7f", "json_escape/0x7f_del_passthrough");
    expect_eq(json_escape("\xc3\xa9"), "\xc3\xa9", "json_escape/utf8_passthrough");

    // --- codepoints_to_utf8: 空・ASCII ---
    {
        std::vector<char32_t> cps;
        expect_eq(codepoints_to_utf8(cps), "", "codepoints/empty");
    }
    {
        std::vector<char32_t> cps = {0x41};
        expect_eq(codepoints_to_utf8(cps), "A", "codepoints/ascii_single");
    }
    {
        std::vector<char32_t> cps = {0x48, 0x69};
        expect_eq(codepoints_to_utf8(cps), "Hi", "codepoints/ascii_multi_sorted");
    }

    // --- codepoints_to_utf8: マルチバイト (2/3/4バイト境界) ---
    {
        std::vector<char32_t> cps = {0x00e9};  // e-acute
        expect_eq(codepoints_to_utf8(cps), "\xc3\xa9", "codepoints/2byte");
    }
    {
        std::vector<char32_t> cps = {0x3042};  // あ
        expect_eq(codepoints_to_utf8(cps), "\xe3\x81\x82", "codepoints/3byte");
    }
    {
        std::vector<char32_t> cps = {0x1f600};  // emoji
        expect_eq(codepoints_to_utf8(cps), "\xf0\x9f\x98\x80", "codepoints/4byte");
    }

    // --- codepoints_to_utf8: ソート+重複除去 ---
    {
        std::vector<char32_t> cps = {0x42, 0x41, 0x41};
        expect_eq(codepoints_to_utf8(cps), "AB", "codepoints/dedup_sort");
    }

    std::printf("----\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
