#include "unified_api.h"

namespace html_to_image {

// Satoru描画結果 SkBitmap → Converter encode への直接受渡しの薄い実装。
// `common/skia_encode` の dispatcher (`encode_single_bitmap`) を呼ぶのみ。
// 文脈保持 (context.set_last_output 等) は呼び出し側の責務 (ヘッダの lifetime注意参照)。
EncodeResult render_bitmap_to_encoded(const SkBitmap& bitmap,
                                      const ConverterEncodeOptions& options) {
    return encode_single_bitmap(bitmap, options);
}

}  // namespace html_to_image
