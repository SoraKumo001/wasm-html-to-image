#include "libs/litehtml/include/litehtml.h"
#ifndef SATORU_TEXT_TYPES_H
#define SATORU_TEXT_TYPES_H

// P2b: types 担当 (text/ 共有型のみ。ロジック禁止)。

#include <algorithm>
#include <bit>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "include/core/SkFont.h"
#include "include/core/SkTextBlob.h"
#include "modules/skshaper/include/SkShaper.h"

namespace satoru {

// One-round mix (Knuth multiplicative + shift). Keys stay POD-sized instead of
// building per-call signature strings (Blink NGShapeCache-style: hash once, keep
// the integer).
inline uint64_t textCacheMix(uint64_t h, uint64_t value) {
    return h ^ (value + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2));
}

// Stable hash of the shaping-affecting font attributes: font-stretch, the
// resolved OpenType features and the variable-font axes. The family is *not*
// included (it is interned to a small integer, see SatoruContext::getFontFamilyId).
// Collisions only cause an extra/mistaken cache hit at 2^-64; the previous
// implementation compared strings with exactly the same value set.
inline uint64_t fontAttributeHash(const litehtml::font_description& desc) {
    uint64_t h = 0xcbf29ce484222325ull;
    h = textCacheMix(h, (uint64_t)(uint32_t)desc.stretch);
    h = textCacheMix(h, (uint64_t)desc.features.size());
    for (const auto& f : desc.features) {
        h = textCacheMix(h, ((uint64_t)f.tag << 32) | (uint64_t)f.value);
    }
    h = textCacheMix(h, (uint64_t)desc.variations.size());
    for (const auto& v : desc.variations) {
        h = textCacheMix(h, ((uint64_t)v.tag << 32) | (uint64_t)std::bit_cast<uint32_t>(v.value));
    }
    return h;
}

struct CharFont {
    size_t len;
    SkFont font;
    bool is_vertical_upright;
    bool is_vertical_punctuation;
    bool is_substitution_failed;
};

struct MeasureResult {
    double width;
    size_t length;              // bytes processed that fit
    bool fits;                  // true if all text fits within max_width
    const char* last_safe_pos;  // pointer to the end of the last character that fits
    std::vector<char32_t> usedCodepoints;
};

struct TextCharAnalysis {
    char32_t codepoint;
    size_t offset;
    size_t len;
    SkFont font;
    bool is_emoji;
    bool is_mark;
    bool is_vertical_upright;
    bool is_vertical_punctuation;
    bool is_substitution_failed;
};

struct TextAnalysis {
    std::vector<TextCharAnalysis> chars;
    std::vector<char> line_breaks;
    std::string substituted_text;
    uint8_t bidi_level;
};

class SatoruFontRunIterator : public SkShaper::FontRunIterator {
   public:
    SatoruFontRunIterator(const std::vector<CharFont>& charFonts)
        : m_charFonts(charFonts), m_currentPos(0), m_currentIndex(0) {}

    void consume() override {
        if (m_currentIndex < m_charFonts.size()) {
            m_currentPos += m_charFonts[m_currentIndex].len;
            m_currentIndex++;
        }
    }

    size_t endOfCurrentRun() const override {
        return m_currentPos +
               (m_currentIndex < m_charFonts.size() ? m_charFonts[m_currentIndex].len : 0);
    }

    bool atEnd() const override { return m_currentIndex >= m_charFonts.size(); }

    const SkFont& currentFont() const override {
        return m_charFonts[std::min(m_currentIndex, m_charFonts.size() - 1)].font;
    }

   private:
    const std::vector<CharFont>& m_charFonts;
    size_t m_currentPos;
    size_t m_currentIndex;
};

struct MeasureKey {
    std::string text;
    // Interned fi->desc.family (SatoruContext::getFontFamilyId). 0 = unset.
    uint32_t font_family_id = 0;
    float font_size;
    int font_weight;
    bool italic;
    double maxWidth;
    litehtml::writing_mode mode;
    litehtml::text_orientation orientation;
    litehtml::text_combine_upright textCombineUpright;
    float letterSpacing;
    float wordSpacing;
    uint64_t fontAttributes = 0;  // fontAttributeHash(): features + variations + stretch
    uint64_t fontVersion = 0;

    bool operator==(const MeasureKey& other) const {
        return font_size == other.font_size && font_weight == other.font_weight &&
               italic == other.italic && maxWidth == other.maxWidth &&
               font_family_id == other.font_family_id && text == other.text && mode == other.mode &&
               orientation == other.orientation && textCombineUpright == other.textCombineUpright &&
               letterSpacing == other.letterSpacing && wordSpacing == other.wordSpacing &&
               fontAttributes == other.fontAttributes && fontVersion == other.fontVersion;
    }
};

struct MeasureKeyHash {
    std::size_t operator()(const MeasureKey& k) const {
        std::size_t h = std::hash<std::string>{}(k.text);
        h ^= std::hash<uint32_t>{}(k.font_family_id) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.font_size) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.font_weight) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<bool>{}(k.italic) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<double>{}(k.maxWidth) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.mode) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.orientation) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.textCombineUpright) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.letterSpacing) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.wordSpacing) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint64_t>{}(k.fontAttributes) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint64_t>{}(k.fontVersion) + 0x9e3779b9 + (h << 6) + (h >> 2);
        return h;
    }
};

struct ShapedResult {
    double width;
    sk_sp<SkTextBlob> blob;
    bool is_emoji;
    // Sorted/unique codepoints of the shaped run, so a cache hit can replay them
    // instead of re-running analyzeText just to collect usedCodepoints. Shared so
    // a hit copies a pointer, not the list.
    std::shared_ptr<const std::vector<char32_t>> usedCodepoints;
};

struct ShapingKey {
    std::string text;
    // Interned fi->desc.family (SatoruContext::getFontFamilyId). 0 = unset.
    uint32_t font_family_id = 0;
    float font_size;
    int font_weight;
    bool italic;
    bool is_rtl;
    litehtml::writing_mode mode;
    litehtml::text_orientation orientation;
    litehtml::text_combine_upright textCombineUpright;
    float letterSpacing;
    float wordSpacing;
    uint64_t fontAttributes = 0;  // fontAttributeHash(): features + variations + stretch
    // Font generation. Ids in font_family_id are never reused, so a font change
    // only has to bump this version to make every pre-change entry unreachable.
    uint64_t fontVersion = 0;

    bool operator==(const ShapingKey& other) const {
        return font_size == other.font_size && font_weight == other.font_weight &&
               italic == other.italic && is_rtl == other.is_rtl &&
               font_family_id == other.font_family_id && text == other.text && mode == other.mode &&
               orientation == other.orientation && textCombineUpright == other.textCombineUpright &&
               letterSpacing == other.letterSpacing && wordSpacing == other.wordSpacing &&
               fontAttributes == other.fontAttributes && fontVersion == other.fontVersion;
    }
};

struct ShapingKeyHash {
    std::size_t operator()(const ShapingKey& k) const {
        std::size_t h = std::hash<std::string>{}(k.text);
        h ^= std::hash<uint32_t>{}(k.font_family_id) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.font_size) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.font_weight) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<bool>{}(k.italic) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<bool>{}(k.is_rtl) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.mode) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.orientation) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<int>{}(k.textCombineUpright) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.letterSpacing) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<float>{}(k.wordSpacing) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint64_t>{}(k.fontAttributes) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint64_t>{}(k.fontVersion) + 0x9e3779b9 + (h << 6) + (h >> 2);
        return h;
    }
};

}  // namespace satoru

#endif  // SATORU_TEXT_TYPES_H
