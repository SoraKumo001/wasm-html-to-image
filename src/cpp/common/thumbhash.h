#ifndef HTML_TO_IMAGE_THUMBHASH_H
#define HTML_TO_IMAGE_THUMBHASH_H

// common/thumbhash: image-opt版を正として1本化。
// 正本: `@node-libraries/wasm-image-optimization/src/cpp/utils/thumbhash.h/.cpp`
// satoru側に対応物なしのため競合なし。ガードを
// `HTML_TO_IMAGE_THUMBHASH_H` に変更し、namespace `html_to_image` で1本化した
// 以外は逐語同一 (wasm_simd128使用のDCTベースThumbHash実装)。
// 旧グローバル名 `::rgbaToThumbHash` での参照は禁止。新規コードは
// `html_to_image::rgbaToThumbHash` を使うこと (`common/skia_encode.cpp` の
// `encode_thumbhash` が本関数へリンクする)。

#include <cstdint>
#include <vector>

namespace html_to_image {

std::vector<uint8_t> rgbaToThumbHash(int w, int h, const uint8_t* rgba);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_THUMBHASH_H
