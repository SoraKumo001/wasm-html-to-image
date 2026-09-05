#include "unified_api.h"

#include <sstream>

#include "../common/skia_encode.h"
#include "../common/skia_utils.h"
#include "include/codec/SkJpegDecoder.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImage.h"
#include "include/core/SkScalar.h"
#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"

namespace html_to_image {

// Satoru描画結果 SkBitmap → Converter encode への直接受渡しの薄い実装。
// `common/skia_encode` の dispatcher (`encode_single_bitmap`) を呼ぶのみ。
// 文脈保持 (context.set_last_output 等) は呼び出し側の責務 (ヘッダの lifetime注意参照)。
EncodeResult render_bitmap_to_encoded(const SkBitmap& bitmap,
                                      const ConverterEncodeOptions& options) {
    return encode_single_bitmap(bitmap, options);
}

std::string encode_image_to_svg(const SkBitmap& bitmap) {
    if (bitmap.isNull() || bitmap.width() <= 0 || bitmap.height() <= 0) return "";
    if (bitmap.getPixels() == nullptr) return "";
    // svg_renderer.cpp の bitmapToDataUrl と等価 (encode_png + base64)。
    sk_sp<SkData> png = encode_png(bitmap.pixmap());
    if (!png || png->size() == 0) return "";
    std::string url =
        "data:image/png;base64," + base64_encode((const uint8_t*)png->data(), png->size());
    const int w = bitmap.width();
    const int h = bitmap.height();
    std::ostringstream out;
    out << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    out << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << w << "\" height=\"" << h
        << "\" viewBox=\"0 0 " << w << " " << h << "\">";
    out << "<image x=\"0\" y=\"0\" width=\"" << w << "\" height=\"" << h << "\" href=\"" << url
        << "\"/>";
    out << "</svg>";
    return out.str();
}

sk_sp<SkData> encode_image_to_pdf(const SkBitmap& bitmap) {
    if (bitmap.isNull() || bitmap.width() <= 0 || bitmap.height() <= 0) return nullptr;
    if (bitmap.getPixels() == nullptr) return nullptr;
    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = "wasm-html-to-image";
    metadata.fCreator = "wasm-html-to-image";
    // SkPDF は jpegDecoder/jpegEncoder の両方必須 (未設定は fatal)。
    // pdf_renderer.cpp の PdfJpegDecoder/PdfJpegEncoder と等価。
    metadata.jpegDecoder = [](sk_sp<const SkData> data) {
        return SkJpegDecoder::Decode(std::move(data), nullptr, nullptr);
    };
    metadata.jpegEncoder = [](SkWStream* dst, const SkPixmap& src, int quality) {
        auto encoded = encode_jpeg(src, quality);
        if (!encoded) return false;
        return dst->write(encoded->data(), encoded->size());
    };
    auto doc = SkPDF::MakeDocument(&stream, metadata);
    if (!doc) return nullptr;
    SkCanvas* canvas =
        doc->beginPage(SkIntToScalar(bitmap.width()), SkIntToScalar(bitmap.height()));
    if (!canvas) return nullptr;
    sk_sp<SkImage> img = bitmap.asImage();
    if (!img) return nullptr;
    canvas->drawImage(img, 0, 0);
    doc->endPage();
    doc->close();
    return stream.detachAsData();
}

}  // namespace html_to_image
