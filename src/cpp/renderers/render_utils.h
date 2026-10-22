#pragma once

#include <algorithm>
#include <cmath>

#include "../bridge/bridge_types.h"
#include "include/core/SkCanvas.h"

// Bitmap size for a source rectangle: an explicit output size wins, else `scale` times the source.
inline void resolve_output_size(const SatoruRenderOptions& options, int src_w, int src_h,
                                int& out_w, int& out_h) {
    const float s = (options.scale > 0.f && options.scale <= 16.f) ? options.scale : 1.f;
    out_w = options.outputWidth > 0 ? options.outputWidth : std::max(1, (int)std::lround(src_w * s));
    out_h = options.outputHeight > 0 ? options.outputHeight : std::max(1, (int)std::lround(src_h * s));
}

inline void apply_resize_transform(SkCanvas* canvas, int src_w, int src_h,
                                   const SatoruRenderOptions& options) {
    if (options.outputWidth > 0 || options.outputHeight > 0) {
        if (src_w < 1) src_w = 1;
        if (src_h < 1) src_h = 1;
        float sx = (float)options.outputWidth / src_w;
        float sy = (float)options.outputHeight / src_h;
        float scaleX = sx, scaleY = sy;
        float dx = 0, dy = 0;

        if (options.fitType == 0) {  // contain
            scaleX = scaleY = std::min(sx, sy);
            dx = (options.outputWidth - src_w * scaleX) * options.fitPositionX;
            dy = (options.outputHeight - src_h * scaleY) * options.fitPositionY;
        } else if (options.fitType == 1) {  // cover
            scaleX = scaleY = std::max(sx, sy);
            dx = (options.outputWidth - src_w * scaleX) * options.fitPositionX;
            dy = (options.outputHeight - src_h * scaleY) * options.fitPositionY;
        }

        canvas->translate(dx, dy);
        canvas->scale(scaleX, scaleY);
    }
}

// Draw transform matching resolve_output_size: the fit transform for an explicit output size,
// else the uniform `scale`.
inline void apply_output_transform(SkCanvas* canvas, int src_w, int src_h,
                                   const SatoruRenderOptions& options) {
    if (options.outputWidth > 0 || options.outputHeight > 0) {
        apply_resize_transform(canvas, src_w, src_h, options);
    } else if (options.scale > 0.f && options.scale <= 16.f && options.scale != 1.f) {
        int out_w, out_h;
        resolve_output_size(options, src_w, src_h, out_w, out_h);
        canvas->scale((float)out_w / (float)src_w, (float)out_h / (float)src_h);
    }
}
