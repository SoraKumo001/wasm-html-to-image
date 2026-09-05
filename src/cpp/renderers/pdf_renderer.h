#ifndef PDF_RENDERER_H
#define PDF_RENDERER_H

#include <string>
#include <vector>

#include "core/satoru_context.h"
#include "include/core/SkData.h"

struct SatoruInstance;
sk_sp<SkData> renderDocumentToPdf(SatoruInstance* inst, int width, int height,
                                  const SatoruRenderOptions& options);

sk_sp<SkData> renderHtmlsToPdf(const std::vector<std::string>& htmls, int width, int height,
                               SatoruContext& context, const char* master_css, const char* user_css,
                               const SatoruRenderOptions& options);

#endif  // PDF_RENDERER_H
