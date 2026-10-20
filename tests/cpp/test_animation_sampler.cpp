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

// --- var() in the stop values ---------------------------------------------
// The sampler keeps the stop values raw: the binding layer owns the
// document (and therefore the custom properties), resolves the var()
// references and asks the sampler to rebuild the stops.

void test_var_stop_values_are_kept_raw() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: var(--o) } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(spec.has_declarations, "a var() stop still declares an animatable property");
    check(spec.needs_resolution, "a var() value is flagged for the resolution");
    check(spec.opacity_raw.size() == 2, "both raw stop values are kept");
    check(spec.opacity_raw[0].value == "var(--o)", "the raw value is the declaration text");
    // Only the stop that parses without a resolution is sampled so far.
    check(spec.stops.size() == 1, "the unresolved stop is not sampled yet");
    check(has_var_reference(spec.opacity_raw[0].value), "the var() reference is detected");
}

void test_resolved_stop_values_are_rebuilt() {
    AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: var(--o) } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    // The binding layer resolves the reference and asks for a rebuild.
    spec.opacity_raw[0].value = "0";
    build_animatable_stops(spec);
    check(spec.stops.size() == 2, "the resolved stop is parsed");
    check(std::fabs(sample_opacity(spec, 0.0f) - 0.0f) < 1e-4f,
          "the resolved opacity is sampled");
    check(std::fabs(sample_opacity(spec, 0.5f) - 0.5f) < 1e-4f,
          "the resolved opacity interpolates linearly");
    check(spec.valid, "the animation is animatable after the resolution");
    check(!spec.needs_resolution, "the resolved value needs no further resolution");
}

void test_resolved_transform_stop_is_rebuilt() {
    AnimationSpec spec = parse_animation(
        doc("@keyframes move { from { transform: var(--t) }"
            " to { transform: translate(100px, 0px) } }"
            ".box { animation-name: move; }"));
    check(spec.transform_stops.empty(), "the unresolved transform is not sampled");
    spec.transform_raw[0].value = "translate(0px, 0px)";
    build_animatable_stops(spec);
    check(spec.transform_stops.size() == 2, "the resolved transform stop is parsed");
    std::string value;
    check(sample_transform(spec, 0.5f, value), "the transform is sampled");
    check(value == "translate(50px, 0px)", "the transform interpolates linearly");
}

void test_unresolved_transform_keeps_the_element_static() {
    AnimationSpec spec = parse_animation(
        doc("@keyframes move { from { transform: var(--t) }"
            " to { transform: translate(100px, 0px) } }"
            ".box { animation-name: move; }"));
    // Without a resolution the transform cannot be interpolated.
    build_animatable_stops(spec);
    std::string value;
    check(!sample_transform(spec, 0.5f, value), "the element stays static");
}

// --- the CSS animation-duration -------------------------------------------

void test_animation_duration_is_captured() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-duration: 2s; }"));
    check(spec.duration_value == "2s", "the CSS duration is captured");
}

void test_animation_duration_from_the_shorthand() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation: fade 250ms infinite; }"));
    check(spec.duration_value == "250ms", "the shorthand duration is captured");
}

void test_animation_duration_with_var_is_raw() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-duration: var(--dur); }"));
    check(spec.duration_value == "var(--dur)", "a var() duration is kept raw");
    check(has_var_reference(spec.duration_value), "the var() duration is detected");
}

void test_parse_time_ms() {
    int ms = -1;
    check(parse_time_ms("2s", ms) && ms == 2000, "seconds are converted to milliseconds");
    check(parse_time_ms("250ms", ms) && ms == 250, "milliseconds are kept");
    check(parse_time_ms("0s", ms) && ms == 0, "a zero duration is accepted");
    check(!parse_time_ms("2", ms), "a unitless value is not a time");
    check(!parse_time_ms("fast", ms), "a keyword is not a time");
}

void test_find_animation_duration_of_a_declaration_block() {
    check(find_animation_duration("animation-duration: 1.5s;") == "1.5s",
          "the longhand duration is found");
    check(find_animation_duration("animation: fade 3s ease-in;") == "3s",
          "the shorthand duration is found");
    check(find_animation_duration("color: red;") == "",
          "a block without a duration reports none");
    // The last declaration wins (CSS cascade inside a declaration block).
    check(find_animation_duration("animation-duration: 1s; animation: fade 2s;") == "2s",
          "the shorthand overrides the earlier longhand");
    check(find_animation_duration("animation: fade 2s; animation-duration: 1s;") == "1s",
          "the longhand overrides the earlier shorthand");
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
    test_var_stop_values_are_kept_raw();
    test_resolved_stop_values_are_rebuilt();
    test_resolved_transform_stop_is_rebuilt();
    test_unresolved_transform_keeps_the_element_static();
    test_animation_duration_is_captured();
    test_animation_duration_from_the_shorthand();
    test_animation_duration_with_var_is_raw();
    test_parse_time_ms();
    test_find_animation_duration_of_a_declaration_block();
    std::printf("%s\n", g_fail == 0 ? "ALL PASS" : "SOME FAILED");
    return g_fail == 0 ? 0 : 1;
}
