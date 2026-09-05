#ifndef PNG_RENDERER_H
#define PNG_RENDERER_H

#include "core/satoru_context.h"
#include "include/core/SkData.h"

struct SatoruInstance;
sk_sp<SkData> renderDocumentToPng(SatoruInstance* inst, int width, int height,
                                  const SatoruRenderOptions& options);

sk_sp<SkData> renderHtmlToPng(const char* html, int width, int height, SatoruContext& context,
                              const char* master_css, const char* user_css,
                              const SatoruRenderOptions& options);

#endif  // PNG_RENDERER_H
