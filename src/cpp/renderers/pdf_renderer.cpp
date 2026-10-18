#include "pdf_renderer.h"

#include <litehtml/master_css.h>

#include <memory>
#include <vector>

#include "api/satoru_api.h"
#include "core/container_skia.h"
#include "include/codec/SkJpegDecoder.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"
#include "include/encode/SkJpegEncoder.h"
#include "common/skia_encode.h"
#include "render_utils.h"
#include "utils/logging.h"

namespace {
std::unique_ptr<SkCodec> PdfJpegDecoder(sk_sp<const SkData> data) {
    return SkJpegDecoder::Decode(std::move(data), nullptr, nullptr);
}

bool PdfJpegEncoder(SkWStream* dst, const SkPixmap& src, int quality) {
    // 寄せ: common/skia_encode の encode_jpeg と等価 (PdfJpegEncoder 署名に適合させる)。
    auto encoded = html_to_image::encode_jpeg(src, quality);
    if (!encoded) return false;
    return dst->write(encoded->data(), encoded->size());
}

std::string replace_template_vars(std::string html, int pageNum, int totalPages) {
    size_t pos;
    std::string pageNumStr = std::to_string(pageNum);
    std::string totalPagesStr = std::to_string(totalPages);

    while ((pos = html.find("{{pageNumber}}")) != std::string::npos) {
        html.replace(pos, 14, pageNumStr);
    }
    while ((pos = html.find("{{totalPages}}")) != std::string::npos) {
        html.replace(pos, 14, totalPagesStr);
    }
    return html;
}

void render_template(const std::string& html, int width, int height, SkCanvas* canvas,
                     SatoruContext& context, const char* master_css, const char* user_css,
                     litehtml::media_type media_type) {
    if (html.empty()) return;
    container_skia container(width, height, canvas, context, nullptr, false, media_type);
    auto doc = litehtml::document::createFromString(html.c_str(), &container, master_css, user_css);
    if (doc) {
        doc->render(width);
        doc->draw(0, 0, 0, nullptr);
        container.flush();
    }
}
}  // namespace

sk_sp<SkData> renderDocumentToPdf(SatoruInstance* inst, int width, int height,
                                  const SatoruRenderOptions& options) {
    if (!inst->doc || !inst->render_container) {
        SATORU_LOG_ERROR("[Satoru] renderDocumentToPdf FAILED: null doc/container");
        return nullptr;
    }

    int content_width = width;
    int content_height = (height > 0) ? height : (int)inst->doc->height();
    if (content_height < 1) content_height = 1;

    int src_x = options.cropX;
    int src_y = options.cropY;
    int src_w = options.cropWidth > 0 ? options.cropWidth : content_width;
    int src_h = options.cropHeight > 0 ? options.cropHeight : content_height;

    int out_width = options.outputWidth > 0 ? options.outputWidth : src_w;
    int out_height = options.outputHeight > 0 ? options.outputHeight : src_h;

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    SkCanvas* canvas = pdf_doc->beginPage((SkScalar)out_width, (SkScalar)out_height);
    if (canvas) {
        if (options.outputWidth > 0 || options.outputHeight > 0) {
            apply_resize_transform(canvas, src_w, src_h, options);
        }

        inst->render_container->reset();
        inst->render_container->set_canvas(canvas);
        inst->render_container->set_height(content_height);
        inst->render_container->set_tagging(false);

        litehtml::media_type media_type =
            (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;
        if (inst->render_container->get_media_type() != media_type) {
            inst->render_container->set_media_type(media_type);
            inst->doc->media_changed();
            inst->doc->render(width);
        }

        litehtml::position clip(0, 0, src_w, src_h);
        inst->doc->draw(0, -src_x, -src_y, &clip);
        inst->render_container->flush();

        pdf_doc->endPage();
    }
    pdf_doc->close();
    return stream.detachAsData();
}

sk_sp<SkData> renderHtmlsToPdf(const std::vector<std::string>& htmls, int width, int height,
                               SatoruContext& context, const char* master_css, const char* user_css,
                               const SatoruRenderOptions& options) {
    if (htmls.empty()) return nullptr;

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    std::string css = master_css ? master_css : litehtml::master_css;
    css += "\nbr { display: -litehtml-br !important; }\n";

    int pageNum = 1;
    int totalPages = (int)htmls.size();

    for (const auto& html : htmls) {
        // Measure pass
        litehtml::media_type media_type =
            (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;

        int margin_top = options.pdfMarginTop;
        int margin_bottom = options.pdfMarginBottom;
        int margin_left = options.pdfMarginLeft;
        int margin_right = options.pdfMarginRight;

        int content_width = width - margin_left - margin_right;
        if (content_width < 1) content_width = 1;

        container_skia measure_container(content_width, height > 0 ? height : 3000, nullptr,
                                         context, nullptr, false, media_type);
        auto measure_doc = litehtml::document::createFromString(html.c_str(), &measure_container,
                                                                css.c_str(), user_css);
        if (!measure_doc) continue;

        measure_doc->render(content_width);

        int measured_height = (height > 0) ? height : (int)measure_doc->height();
        int full_page_height = measured_height + margin_top + margin_bottom;
        if (full_page_height < 1) full_page_height = 1;

        SkCanvas* canvas = pdf_doc->beginPage((SkScalar)width, (SkScalar)full_page_height);
        if (!canvas) continue;

        if (options.backgroundColor != 0) {
            SkPaint paint;
            paint.setColor(options.backgroundColor);
            canvas->drawRect(SkRect::MakeWH(width, full_page_height), paint);
        }

        // Render Header
        if (!options.pdfHeader.empty()) {
            std::string headerHtml = replace_template_vars(options.pdfHeader, pageNum, totalPages);
            canvas->save();
            canvas->translate((SkScalar)margin_left, 0);
            render_template(headerHtml, content_width, margin_top, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        // Render Footer
        if (!options.pdfFooter.empty()) {
            std::string footerHtml = replace_template_vars(options.pdfFooter, pageNum, totalPages);
            canvas->save();
            canvas->translate((SkScalar)margin_left, (SkScalar)(full_page_height - margin_bottom));
            render_template(footerHtml, content_width, margin_bottom, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        // Render Content
        canvas->save();
        canvas->translate((SkScalar)margin_left, (SkScalar)margin_top);

        container_skia render_container(content_width, measured_height, canvas, context, nullptr,
                                        false, media_type);
        auto render_doc = litehtml::document::createFromString(html.c_str(), &render_container,
                                                               css.c_str(), user_css);
        if (!render_doc) continue;
        render_doc->render(content_width);
        render_doc->draw(0, 0, 0, nullptr);
        render_container.flush();

        canvas->restore();

        pdf_doc->endPage();
        pageNum++;
    }

    pdf_doc->close();

    return stream.detachAsData();
}

// P1: single-HTML multi-page PDF via "Layout once + Slice". This path is independent of
// renderHtmlsToPdf's array (one-item-per-page) approach:
//   1) lay the document out exactly once at contentWidth,
//   2) derive the page count from doc->height(),
//   3) for each page: beginPage -> (per-page background) -> header/footer re-render (same as
//      renderHtmlsToPdf today) -> draw the shared document shifted by -page*contentAreaHeight and
//      clipped to the page's content area -> endPage.
//
// pageHeight = height(>0) : options.outputHeight(>0) : A4 @96dpi (1123px). contentAreaHeight is
// pageHeight minus the top/bottom margins.
//
// Notes / accepted limitations (P1):
//   - The slice cuts between the layout's painted pixels; a line/element straddling a page
//     boundary is simply clipped. litehtml has no break/avoid-break, so this is by design.
//   - position:fixed: litehtml draws fixed elements ignoring the doc->draw (x,y) offset
//     (render_item.cpp draws them with draw(hdc, 0, 0, ...)), so the vertical page shift (which is
//     applied through the draw offset rather than a canvas translate) leaves them in place ->
//     they are re-painted at the same viewport position on every page.
//   - position:sticky: litehtml has no sticky positioning (element_position only has
//     static/relative/absolute/fixed), so a "sticky" element is laid out as normal flow and
//     painted once, wherever it lands. Provisionally accepted.
sk_sp<SkData> renderHtmlToPdf(const std::string& html, int width, int height,
                              SatoruContext& context, const char* master_css, const char* user_css,
                              const SatoruRenderOptions& options) {
    if (html.empty()) return nullptr;

    int margin_top = options.pdfMarginTop;
    int margin_bottom = options.pdfMarginBottom;
    int margin_left = options.pdfMarginLeft;
    int margin_right = options.pdfMarginRight;

    int content_width = width - margin_left - margin_right;
    if (content_width < 1) content_width = 1;

    // Page height: explicit render height wins, then outputHeight, else A4 @96dpi (1123px).
    int page_height = (height > 0) ? height
                                   : (options.outputHeight > 0 ? options.outputHeight : 1123);
    int content_area_height = page_height - margin_top - margin_bottom;
    if (content_area_height < 1) content_area_height = 1;

    std::string css = master_css ? master_css : litehtml::master_css;
    css += "\nbr { display: -litehtml-br !important; }\n";

    litehtml::media_type media_type =
        (options.mediaType == 1) ? litehtml::media_type_print : litehtml::media_type_screen;

    // Layout once. The container is reused for every page (reset + set_canvas below), matching the
    // document-reuse pattern already used elsewhere in this file.
    container_skia container(content_width, content_area_height, nullptr, context, nullptr, false,
                             media_type);
    auto doc = litehtml::document::createFromString(html.c_str(), &container, css.c_str(), user_css);
    if (!doc) return nullptr;

    doc->render(content_width);
    int doc_height = (int)doc->height();
    if (doc_height < 1) doc_height = 1;

    int page_count = (doc_height + content_area_height - 1) / content_area_height;
    if (page_count < 1) page_count = 1;

    SkDynamicMemoryWStream stream;
    SkPDF::Metadata metadata;
    metadata.fTitle = options.pdfTitle.empty() ? "Satoru PDF Export" : options.pdfTitle.c_str();
    metadata.fAuthor = options.pdfAuthor.c_str();
    metadata.fSubject = options.pdfSubject.c_str();
    metadata.fKeywords = options.pdfKeywords.c_str();
    metadata.fCreator = options.pdfCreator.empty() ? "Satoru Engine" : options.pdfCreator.c_str();
    metadata.fProducer = options.pdfProducer.c_str();
    metadata.jpegDecoder = PdfJpegDecoder;
    metadata.jpegEncoder = PdfJpegEncoder;

    auto pdf_doc = SkPDF::MakeDocument(&stream, metadata);
    if (!pdf_doc) return nullptr;

    for (int page = 0; page < page_count; ++page) {
        int page_num = page + 1;
        SkCanvas* canvas = pdf_doc->beginPage((SkScalar)width, (SkScalar)page_height);
        if (!canvas) continue;

        if (options.backgroundColor != 0) {
            SkPaint paint;
            paint.setColor(options.backgroundColor);
            canvas->drawRect(SkRect::MakeWH(width, page_height), paint);
        }

        // Header / footer: re-rendered per page (same as renderHtmlsToPdf).
        if (!options.pdfHeader.empty()) {
            std::string headerHtml = replace_template_vars(options.pdfHeader, page_num, page_count);
            canvas->save();
            canvas->translate((SkScalar)margin_left, 0);
            render_template(headerHtml, content_width, margin_top, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        if (!options.pdfFooter.empty()) {
            std::string footerHtml = replace_template_vars(options.pdfFooter, page_num, page_count);
            canvas->save();
            canvas->translate((SkScalar)margin_left, (SkScalar)(page_height - margin_bottom));
            render_template(footerHtml, content_width, margin_bottom, canvas, context, css.c_str(),
                            user_css, media_type);
            canvas->restore();
        }

        // Content slice: the page shift is applied through the draw offset (so fixed elements,
        // which ignore it, stay at their viewport position); the canvas clip bounds the page.
        canvas->save();
        canvas->translate((SkScalar)margin_left, (SkScalar)margin_top);
        canvas->clipRect(SkRect::MakeXYWH(0, 0, (SkScalar)content_width, (SkScalar)content_area_height));

        container.reset();
        container.set_canvas(canvas);
        container.set_height(content_area_height);
        container.set_tagging(false);
        doc->draw(0, 0, -(litehtml::pixel_t)(page * content_area_height), nullptr);
        container.flush();

        canvas->restore();

        pdf_doc->endPage();
    }

    pdf_doc->close();

    return stream.detachAsData();
}
