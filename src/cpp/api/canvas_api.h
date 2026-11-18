#ifndef HTML_TO_IMAGE_CANVAS_API_H
#define HTML_TO_IMAGE_CANVAS_API_H

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "../bridge/bridge_types.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkImageFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkShader.h"

class ImageConverterInstance;

enum class CanvasOp : uint8_t {
    Save = 1,
    Restore = 2,
    Translate = 3,
    Scale = 4,
    Rotate = 5,
    Transform = 6,
    SetTransform = 7,
    ResetTransform = 8,
    ClipRect = 9,
    ClipPath = 10,
    FillRect = 11,
    StrokeRect = 12,
    ClearRect = 13,
    BeginPath = 14,
    ClosePath = 15,
    MoveTo = 16,
    LineTo = 17,
    QuadraticCurveTo = 18,
    BezierCurveTo = 19,
    Arc = 20,
    ArcTo = 21,
    Ellipse = 22,
    Rect = 23,
    RoundRect = 24,
    Fill = 25,
    Stroke = 26,
    SetFillColor = 27,
    SetStrokeColor = 28,
    SetFillLinearGradient = 29,
    SetStrokeLinearGradient = 30,
    SetFillRadialGradient = 31,
    SetStrokeRadialGradient = 32,
    SetFillConicGradient = 33,
    SetStrokeConicGradient = 34,
    SetLineWidth = 35,
    SetLineCap = 36,
    SetLineJoin = 37,
    SetMiterLimit = 38,
    SetLineDash = 39,
    SetLineDashOffset = 40,
    SetGlobalAlpha = 41,
    SetBlendMode = 42,
    SetShadow = 43,
    SetFilter = 44,
    SetImageSmoothing = 45,
    AddSvgPath = 46,
};

struct CanvasPaintStyle {
    bool is_shader = false;
    SkColor color = SK_ColorBLACK;
    sk_sp<SkShader> shader;
};

struct CanvasState {
    CanvasPaintStyle fill_style;
    CanvasPaintStyle stroke_style;
    float line_width = 1.0f;
    SkPaint::Cap line_cap = SkPaint::kButt_Cap;
    SkPaint::Join line_join = SkPaint::kMiter_Join;
    float miter_limit = 10.0f;
    std::vector<float> line_dash;
    float line_dash_offset = 0.0f;
    float global_alpha = 1.0f;
    SkBlendMode blend_mode = SkBlendMode::kSrcOver;
    SkColor shadow_color = SK_ColorTRANSPARENT;
    float shadow_blur = 0.0f;
    float shadow_offset_x = 0.0f;
    float shadow_offset_y = 0.0f;
    sk_sp<SkImageFilter> filter;
    bool image_smoothing_enabled = true;
    int image_smoothing_quality = 1;  // 0=low, 1=medium, 2=high
};

class CanvasInstance {
   public:
    SkBitmap bitmap;
    std::unique_ptr<SkCanvas> canvas;
    SkPathBuilder path_builder;
    std::vector<CanvasState> state_stack;
    CanvasState current_state;
    sk_sp<SkData> last_encoded;

    CanvasInstance(int width, int height);
    ~CanvasInstance();

    bool resize(int width, int height);
    int width() const { return bitmap.width(); }
    int height() const { return bitmap.height(); }

    bool exec_batch(const uint8_t* ops, size_t op_count, const double* args, size_t arg_count,
                    const std::vector<std::string>& strings);

    bool draw_image_bytes(const uint8_t* data, size_t size, double sx, double sy, double sw,
                          double sh, double dx, double dy, double dw, double dh,
                          bool has_src_rect);
    bool draw_converter(ImageConverterInstance* src, int frame_index, double sx, double sy,
                        double sw, double sh, double dx, double dy, double dw, double dh,
                        bool has_src_rect);
    bool draw_canvas(CanvasInstance* src, double sx, double sy, double sw, double sh, double dx,
                     double dy, double dw, double dh, bool has_src_rect);

    bool get_image_data(int x, int y, int w, int h, std::vector<uint8_t>& out_rgba) const;
    bool put_image_data(const uint8_t* rgba, size_t byte_len, int x, int y, int w, int h);

    bool to_converter(ImageConverterInstance* dst) const;
    const uint8_t* encode(RenderFormat format, float quality, int speed, int& out_size);

   private:
    SkPaint build_paint(bool is_stroke) const;
    SkSamplingOptions current_sampling() const;
    bool draw_sk_image(const sk_sp<SkImage>& img, double sx, double sy, double sw, double sh,
                       double dx, double dy, double dw, double dh, bool has_src_rect);
};

CanvasInstance* canvas_api_create_instance(int width, int height);
void canvas_api_destroy_instance(CanvasInstance* inst);

#endif  // HTML_TO_IMAGE_CANVAS_API_H
