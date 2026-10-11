#ifndef PNG_RENDERER_H
#define PNG_RENDERER_H

#include "core/satoru_context.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkData.h"

class SatoruInstance;
sk_sp<SkData> renderDocumentToPng(SatoruInstance* inst, int width, int height,
                                  const SatoruRenderOptions& options);

// Render to an N32 premul sRGB bitmap (no encode). Returns false on parse failure.
bool renderHtmlToBitmap(const char* html, int width, int height, SatoruContext& context,
                        const char* master_css, const char* user_css,
                        const SatoruRenderOptions& options, SkBitmap& out);

sk_sp<SkData> renderHtmlToPng(const char* html, int width, int height, SatoruContext& context,
                              const char* master_css, const char* user_css,
                              const SatoruRenderOptions& options);

#endif  // PNG_RENDERER_H
