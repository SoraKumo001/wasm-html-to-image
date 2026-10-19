// tests/cpp/test_animation_sampler.cpp — core/animation_sampler.h のホスト単体テスト
// 方式: test_lru_cache.cpp と同じ最小ランナー (標準ライブラリのみ・ctest 登録)。
// animation_sampler.h は litehtml/Skia 非依存の純粋ヘッダなので単体で検証できる。

#include <cstdio>
#include <string>
#include <vector>

#include "core/animation_sampler.h"

namespace {

int g_fail = 0;

void check(bool ok, const char* name) {
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) ++g_fail;
}

using namespace html_to_image;

std::string doc(const std::string& css) {
    return "<html><head><style>" + css + "</style></head><body></body></html>";
}

void test_opacity_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(spec.valid, "opacity keyframes are parsed");
    check(spec.selector == ".box", "the binding selector is found");
    check(spec.stops.size() == 2, "two opacity stops");
    check(std::fabs(sample_opacity(spec, 0.5f) - 0.5f) < 1e-4f, "opacity interpolates linearly");
}

void test_opacity_percentage() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0% } to { opacity: 100% } }"
            ".box { animation-name: fade; }"));
    check(spec.stops.size() == 2, "two opacity stops");
    check(std::fabs(spec.stops[1].opacity - 1.0f) < 1e-4f,
          "a percentage opacity is scaled to 0..1");
}

void test_transform_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes move { from { transform: translate(0px, 0px) }"
            " to { transform: translate(100px, 40px) } }"
            ".box { animation-name: move; }"));
    check(spec.valid, "transform keyframes are parsed");
    check(spec.transform_stops.size() == 2, "two transform stops");
    std::string value;
    check(sample_transform(spec, 0.5f, value), "the transform is sampled");
    check(value == "translate(50px, 20px)", "the transform interpolates linearly");
}

void test_transform_signature_mismatch_is_static() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes move { from { transform: translate(0px, 0px) }"
            " to { transform: rotate(90deg) } }"
            ".box { animation-name: move; }"));
    check(spec.transform_stops.empty(), "a mismatching function list drops the transform");
    std::string value;
    check(!sample_transform(spec, 0.5f, value), "the element stays static");
    // Nothing else is animated, so the whole animation is skipped.
    check(!spec.valid, "the animation is skipped when nothing else can be animated");

    // Opacity still animates: only the transform falls back to static.
    const AnimationSpec mixed = parse_animation(
        doc("@keyframes move { from { opacity: 0; transform: translate(0px, 0px) }"
            " to { opacity: 1; transform: rotate(90deg) } }"
            ".box { animation-name: move; }"));
    check(mixed.valid, "the animation stays valid when opacity can be animated");
    check(mixed.transform_stops.empty(), "the mismatching transform is dropped");
    check(mixed.stops.size() == 2, "the opacity stops are kept");
}

void test_transform_unsupported_function_is_static() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes move { from { transform: translateX(0px) }"
            " to { transform: translateX(100px) } }"
            ".box { animation-name: move; }"));
    check(spec.transform_stops.empty(), "translateX is not supported");
}

void test_color_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes tint { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(spec.valid, "color keyframes are parsed");
    check(spec.color_stops.size() == 2, "two colour stops");
    check(spec.color_stops[0].value == "#ff0000", "the raw colour value is kept");
}

void test_background_color_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes tint { from { background-color: #ff0000 }"
            " to { background-color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(spec.background_color_stops.size() == 2, "two background-color stops");
}

void test_colour_interpolation() {
    std::vector<ColorKeyframe> stops = {{0.0f, Rgba{255, 0, 0, 255}},
                                        {1.0f, Rgba{0, 0, 255, 255}}};
    const Rgba mid = sample_color(stops, 0.5f);
    check(mid.r == 128 && mid.g == 0 && mid.b == 128, "colours interpolate linearly");
    check(format_rgba(Rgba{0, 128, 255, 255}) == "#0080ff", "opaque colours format as hex");
}

void test_block_bound_animation_is_selected() {
    // The first block is not bound, the second one is: the bound one wins.
    const AnimationSpec spec = parse_animation(
        doc("@keyframes unused { from { opacity: 0 } to { opacity: 1 } }"
            "@keyframes tint { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(spec.name == "tint", "the bound keyframes block is selected");
    check(spec.color_stops.size() == 2, "the bound block carries the colour stops");
}

void test_frame_schedule() {
    const std::vector<FrameSample> schedule = build_frame_schedule(300, 10);
    check(schedule.size() == 3, "the frame count follows duration*fps");
    int total = 0;
    for (const auto& frame : schedule) total += frame.duration_ms;
    check(total == 300, "the frame durations sum up to the requested duration");
}

}  // namespace

int main() {
    test_opacity_stops();
    test_opacity_percentage();
    test_transform_stops();
    test_transform_signature_mismatch_is_static();
    test_transform_unsupported_function_is_static();
    test_color_stops();
    test_background_color_stops();
    test_colour_interpolation();
    test_block_bound_animation_is_selected();
    test_frame_schedule();
    std::printf("%s\n", g_fail == 0 ? "ALL PASS" : "SOME FAILED");
    return g_fail == 0 ? 0 : 1;
}
