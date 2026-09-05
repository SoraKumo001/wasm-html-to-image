#ifndef HTML_TO_IMAGE_SVG_PATCH_H
#define HTML_TO_IMAGE_SVG_PATCH_H

#include <string>

#include "include/core/SkData.h"
#include "include/core/SkRefCnt.h"

namespace html_to_image {

// converter側 image_converter_api.cpp:408-563 の patch_svg_data を共通抽出。
// 3種の ctre パッチを適用する:
//   1. feDropShadow -> feGaussianBlur/feOffset/feFlood/feComposite/feMerge 展開
//      (Skia SVG DOM が feDropShadow 未対応のため)
//   2. pattern 内 linearGradient の取出し + url(#patternId) -> url(#gradId) 置換
//      (Satori 由来ワークアラウンド)
//   3. <image> の href="data:..." -> xlink:href 付与 + xmlns:xlink 補完
//
// 差分メモ (satoru側 image_decoder.cpp:72-76 との差):
//   - satoru側 patch_svg_data は no-op (入力をそのまま返す)。
//     理由コメント: "Complex patching with ctre caused RuntimeError in Wasm due to
//     stack usage. For now, return original data."
//   - 本ファイルは converter側の完全版を採用する。Wasm スタック問題は
//     COMMON_COMPILE_OPTIONS (-Oz / -mbulk-memory 等) の統一ビルドで再検証する。
//     問題が再発した場合のみ satoru側 no-op への切替えを検討する。
sk_sp<SkData> patch_svg_data(const sk_sp<SkData>& data);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_SVG_PATCH_H
