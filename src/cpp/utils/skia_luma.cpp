// Luminance-to-alpha color filter without SkSL.
//
// Skia implements SkLumaColorFilter::Make() with a known SkRuntimeEffect, but this build ships
// with SkSL disabled (SkRuntimeEffect is stubbed, see skia_stubs.cpp), so calling it aborts the
// wasm instance ("null function or function signature mismatch"). SVG <mask> uses it, so any
// inline SVG with a mask killed the render. cmake/skia.cmake redirects SkLumaColorFilter::Make()
// to satoru_make_luma_filter() below, which does the same arithmetic as the SkSL effect
// (alpha = dot(luma coefficients, premultiplied rgb), rgb = 0) with a raster-pipeline matrix.
#include "include/core/SkColorFilter.h"
#include "include/core/SkRefCnt.h"
#include "src/core/SkEffectPriv.h"
#include "src/core/SkRasterPipeline.h"
#include "src/core/SkRasterPipelineOpList.h"
#include "src/effects/colorfilters/SkColorFilterBase.h"

namespace {

class SatoruLumaColorFilter final : public SkColorFilterBase {
public:
    bool appendStages(const SkStageRec& rec, bool) const override {
        // matrix_4x5 takes a row-major 4x5 matrix (r', g', b', a' rows; r, g, b, a, 1 columns),
        // the same layout SkMatrixColorFilter uses. Only the alpha row is non-zero, and it is
        // applied to premultiplied color, which is what the SkSL luma effect does.
        static const float kMatrix[20] = {
                0.0f,    0.0f,    0.0f,    0.0f, 0.0f,  // r' = 0
                0.0f,    0.0f,    0.0f,    0.0f, 0.0f,  // g' = 0
                0.0f,    0.0f,    0.0f,    0.0f, 0.0f,  // b' = 0
                0.2126f, 0.7152f, 0.0722f, 0.0f, 0.0f,  // a' = luma(rgb)
        };
        rec.fPipeline->append(SkRasterPipelineOp::matrix_4x5, kMatrix);
        rec.fPipeline->append(SkRasterPipelineOp::clamp_01);
        return true;
    }

    SkColorFilterBase::Type type() const override { return SkColorFilterBase::Type::kNoop; }

    SK_FLATTENABLE_HOOKS(SatoruLumaColorFilter)
    void flatten(SkWriteBuffer&) const override {}
};

sk_sp<SkFlattenable> SatoruLumaColorFilter::CreateProc(SkReadBuffer&) {
    return sk_make_sp<SatoruLumaColorFilter>();
}

}  // namespace

sk_sp<SkColorFilter> satoru_make_luma_filter() { return sk_make_sp<SatoruLumaColorFilter>(); }
