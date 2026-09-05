#ifndef HTML_TO_IMAGE_IMAGE_CONVERTER_CONTEXT_H
#define HTML_TO_IMAGE_IMAGE_CONVERTER_CONTEXT_H

// core/image_converter_context: image-opt版を正として逐語移植。
// 正本: `@node-libraries/wasm-image-optimization/src/cpp/core/image_converter_context.h/.cpp`
// 変更点: ガード名のみ。API・振る舞い同一。

#include <memory>
#include <vector>

#include "include/core/SkBitmap.h"
#include "include/core/SkData.h"

class ImageConverterContext {
    sk_sp<SkData> m_lastOutput;

   public:
    ImageConverterContext() {}

    void init();

    void set_last_output(sk_sp<SkData> data) { m_lastOutput = std::move(data); }
    const sk_sp<SkData>& get_last_output() const { return m_lastOutput; }
    size_t get_last_output_size() const { return m_lastOutput ? m_lastOutput->size() : 0; }
};

#endif  // HTML_TO_IMAGE_IMAGE_CONVERTER_CONTEXT_H
