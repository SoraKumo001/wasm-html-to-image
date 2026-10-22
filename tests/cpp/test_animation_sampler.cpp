// tests/cpp/test_animation_sampler.cpp — core/animation_sampler.h のホスト単体テスト
// 方式: test_lru_cache.cpp と同じ最小ランナー (標準ライブラリのみ・ctest 登録)。
// animation_sampler.h は litehtml/Skia 非依存の純粋ヘッダなので単体で検証できる。
// 方針: 同じ性質を複数の関数で重複して確かめない (20 関数に集約)。

#include <cmath>
#include <cstdio>
#include <limits>
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

// opacity (数値 / パーセント) と束縛セレクタ。
void test_opacity_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(spec.valid, "opacity keyframes are parsed");
    check(spec.selector == ".box", "the binding selector is found");
    check(spec.stops.size() == 2, "two opacity stops");
    check(std::fabs(sample_opacity(spec, 0.5f) - 0.5f) < 1e-4f, "opacity interpolates linearly");

    // `opacity: 50%` is 0.5: a percentage is scaled to 0..1.
    const AnimationSpec pct = parse_animation(
        doc("@keyframes fade { from { opacity: 0% } to { opacity: 100% } }"
            ".box { animation-name: fade; }"));
    check(pct.stops.size() == 2 && std::fabs(pct.stops[1].opacity - 1.0f) < 1e-4f,
          "a percentage opacity is scaled to 0..1");
}

// transform の補間と translateX の正規化 (translateY / unitless zero は対象外)。
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

    const AnimationSpec x = parse_animation(
        doc("@keyframes move { from { transform: translateX(0px) }"
            " to { transform: translateX(100px) } }"
            ".box { animation-name: move; }"));
    check(x.transform_stops.size() == 2, "translateX is parsed");
    check(sample_transform(x, 0.5f, value) && value == "translate(50px, 0px)",
          "translateX becomes translate(x,0px)");
}

// 補間できない transform (関数リスト不一致 / 未対応関数) は static に落ちる。
void test_transform_mismatch_and_unsupported() {
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
    check(mixed.valid && mixed.stops.size() == 2,
          "the animation stays valid when opacity can be animated");
    check(mixed.transform_stops.empty(), "the mismatching transform is dropped");

    const AnimationSpec skew = parse_animation(
        doc("@keyframes move { from { transform: skewX(0deg) }"
            " to { transform: skewX(30deg) } }"
            ".box { animation-name: move; }"));
    check(skew.transform_stops.empty(), "skewX is not supported");
}

// 1 つの @keyframes を複数ルールが束縛する / カンマ区切りのアニメーションリスト。
void test_keyframes_binding() {
    const std::vector<AnimationSpec> specs = parse_animations(
        doc("@keyframes tint { from { color: #ff0000 } to { color: #0000ff } }"
            ".a { animation: tint 2s; } .b { animation: tint 4s; }"));
    check(specs.size() == 2, "one spec per binding rule");
    check(specs.size() == 2 && specs[0].selector == ".a" && specs[1].selector == ".b",
          "each spec keeps its selector");
    check(specs.size() == 2 && specs[0].timing.duration == "2s" && specs[1].timing.duration == "4s",
          "each spec keeps its own timing");

    const std::vector<AnimationSpec> list = parse_animations(
        doc("@keyframes a { from { opacity: 0 } to { opacity: 1 } }"
            "@keyframes b { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation: a 2s, b 3s; }"));
    check(list.size() == 2, "both keyframes of the list are bound");
    check(list.size() == 2 && list[0].timing.duration == "2s" && list[1].timing.duration == "3s",
          "each keyframes takes its own list item");

    const std::vector<AnimationSpec> longhand = parse_animations(
        doc("@keyframes a { from { opacity: 0 } to { opacity: 1 } }"
            "@keyframes b { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation-name: a, b; animation-duration: 2s, 3s; }"));
    check(longhand.size() == 2 && longhand[1].timing.duration == "3s",
          "longhand lists are matched by index");
}

// colour / background-color の生値と、束縛されたブロックだけが選ばれること。
void test_color_stops() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes tint { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(spec.valid, "color keyframes are parsed");
    check(spec.color_stops.size() == 2, "two colour stops");
    check(spec.color_stops[0].value == "#ff0000", "the raw colour value is kept");

    const AnimationSpec bg = parse_animation(
        doc("@keyframes tint { from { background-color: #ff0000 }"
            " to { background-color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(bg.background_color_stops.size() == 2, "two background-color stops");

    // The first block is not bound, the second one is: the bound one wins.
    const AnimationSpec bound = parse_animation(
        doc("@keyframes unused { from { opacity: 0 } to { opacity: 1 } }"
            "@keyframes tint { from { color: #ff0000 } to { color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(bound.name == "tint" && bound.color_stops.size() == 2,
          "the bound keyframes block is selected");
}

void test_colour_interpolation() {
    std::vector<ColorKeyframe> stops = {{0.0f, Rgba{255, 0, 0, 255}},
                                        {1.0f, Rgba{0, 0, 255, 255}}};
    const Rgba mid = sample_color(stops, 0.5f);
    check(mid.r == 128 && mid.g == 0 && mid.b == 128, "colours interpolate linearly");
    check(format_rgba(Rgba{0, 128, 255, 255}) == "#0080ff", "opaque colours format as hex");
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

// 未解決の var() は生値のまま保持され、サンプリング対象にならない。
void test_var_stop_values_are_kept_raw() {
    AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: var(--o) } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(spec.has_declarations, "a var() stop still declares an animatable property");
    check(spec.needs_resolution, "a var() value is flagged for the resolution");
    check(spec.opacity_raw.size() == 2, "both raw stop values are kept");
    check(spec.opacity_raw[0].value == "var(--o)", "the raw value is the declaration text");
    // Only the stop that parses without a resolution is sampled so far.
    check(spec.stops.size() == 1, "the unresolved stop is not sampled yet");
    check(has_var_reference(spec.opacity_raw[0].value), "the var() reference is detected");

    // transform も未解決のままでは補間できない。
    AnimationSpec move = parse_animation(
        doc("@keyframes move { from { transform: var(--t) }"
            " to { transform: translate(100px, 0px) } }"
            ".box { animation-name: move; }"));
    check(move.transform_stops.empty(), "the unresolved transform is not sampled");
    build_animatable_stops(move);
    std::string value;
    check(!sample_transform(move, 0.5f, value), "the element stays static");
}

// 解決後の再ビルドで opacity / transform の両方がサンプリング可能になる。
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

    AnimationSpec move = parse_animation(
        doc("@keyframes move { from { transform: var(--t) }"
            " to { transform: translate(100px, 0px) } }"
            ".box { animation-name: move; }"));
    move.transform_raw[0].value = "translate(0px, 0px)";
    build_animatable_stops(move);
    std::string value;
    check(move.transform_stops.size() == 2, "the resolved transform stop is parsed");
    check(sample_transform(move, 0.5f, value) && value == "translate(50px, 0px)",
          "the resolved transform interpolates linearly");
}

// --- the CSS animation-duration -------------------------------------------

// longhand / shorthand / var() の duration 捕捉と <time> の解釈。
void test_animation_duration() {
    const AnimationSpec longhand = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-duration: 2s; }"));
    check(longhand.duration_value == "2s", "the CSS duration is captured");

    const AnimationSpec shorthand = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation: fade 250ms infinite; }"));
    check(shorthand.duration_value == "250ms", "the shorthand duration is captured");

    const AnimationSpec raw = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-duration: var(--dur); }"));
    check(raw.duration_value == "var(--dur)" && has_var_reference(raw.duration_value),
          "a var() duration is kept raw and detected");

    int ms = -1;
    check(parse_time_ms("2s", ms) && ms == 2000, "seconds are converted to milliseconds");
    check(parse_time_ms("250ms", ms) && ms == 250, "milliseconds are kept");
    check(!parse_time_ms("2", ms), "a unitless value is not a time");
    check(!parse_time_ms("fast", ms), "a keyword is not a time");
}

// 宣言ブロック内のカスケード (shorthand と longhand の後勝ち)。
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

// --- per-keyframe easing ---------------------------------------------------
// The timing function declared inside a keyframe block applies to the
// interval that starts at that stop; the element-level value is the default.

void test_per_keyframe_easing_is_applied() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0; animation-timing-function: ease-in }"
            " to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(spec.stops.size() == 2, "two opacity stops");
    check(spec.stops[0].easing.kind == EasingKind::kCubicBezier,
          "the keyframe timing function is parsed");
    const float mid = sample_opacity(spec, 0.5f);
    check(mid > 0.2f && mid < 0.45f, "ease-in samples below the linear midpoint");
    check(std::fabs(sample_opacity(spec, 0.0f) - 0.0f) < 1e-4f,
          "the eased interval still starts at the from value");
    check(std::fabs(sample_opacity(spec, 1.0f) - 1.0f) < 1e-4f,
          "the eased interval still reaches the to value");
}

// 要素側の既定値・キーフレーム側の上書き・shorthand からの既定値。
void test_element_timing_function_and_keyframe_override() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-timing-function: ease-in; }"));
    check(spec.default_easing.kind == EasingKind::kCubicBezier,
          "the element timing function becomes the default");
    check(spec.stops[0].easing.kind == EasingKind::kCubicBezier,
          "a stop without a timing function inherits the default");
    check(sample_opacity(spec, 0.5f) < 0.45f,
          "the default timing function shapes the frame");

    const AnimationSpec override = parse_animation(
        doc("@keyframes fade { from { opacity: 0; animation-timing-function: linear }"
            " to { opacity: 1 } }"
            ".box { animation-name: fade; animation-timing-function: ease-in; }"));
    check(std::fabs(sample_opacity(override, 0.5f) - 0.5f) < 1e-4f,
          "the per-keyframe timing function wins over the element default");

    const AnimationSpec shorthand = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation: fade 300ms ease-in; }"));
    check(shorthand.timing.timing_function == "ease-in" &&
              shorthand.default_easing.kind == EasingKind::kCubicBezier,
          "the shorthand timing function becomes the default");
}

void test_cubic_bezier_and_steps_evaluation() {
    Easing linear;
    check(parse_timing_function("linear", linear) && std::fabs(apply_timing_function(linear, 0.5f) - 0.5f) < 1e-4f,
          "linear is the identity curve");

    Easing bezier;
    check(parse_timing_function("cubic-bezier(0, 0, 1, 1)", bezier),
          "a cubic-bezier() value is parsed");
    check(std::fabs(apply_timing_function(bezier, 0.5f) - 0.5f) < 1e-3f,
          "the identity cubic-bezier is the identity curve");
    check(parse_timing_function("cubic-bezier(0.25, 0.1, 0.25, 1)", bezier),
          "the ease control points are parsed");
    check(apply_timing_function(bezier, 0.25f) > 0.25f,
          "ease starts faster than linear");

    Easing steps;
    check(parse_timing_function("steps(4, end)", steps), "steps() is parsed");
    check(std::fabs(apply_timing_function(steps, 0.3f) - 0.25f) < 1e-4f,
          "steps(4, end) holds the step value");
    check(std::fabs(apply_timing_function(steps, 0.99f) - 0.75f) < 1e-4f,
          "steps(4, end) keeps the last step until the end");
    check(std::fabs(apply_timing_function(steps, 1.0f) - 1.0f) < 1e-4f,
          "steps() still reaches the end value");

    Easing start_steps;
    check(parse_timing_function("steps(2, start)", start_steps),
          "steps(n, start) is parsed");
    check(std::fabs(apply_timing_function(start_steps, 0.0f) - 0.5f) < 1e-4f,
          "steps(2, start) jumps at the beginning");
    check(std::fabs(apply_timing_function(start_steps, 0.6f) - 1.0f) < 1e-4f,
          "steps(2, start) reaches the last step on the second half");

    Easing step_start;
    check(parse_timing_function("step-start", step_start) &&
              std::fabs(apply_timing_function(step_start, 0.0f) - 1.0f) < 1e-4f,
          "step-start is steps(1, start)");
    check(!parse_timing_function("steps(2, jump-none)", steps),
          "an unsupported step position is rejected");
    check(!parse_timing_function("wobble", steps), "an unknown keyword is rejected");
}

void test_eased_colour_and_transform() {
    const AnimationSpec colour = parse_animation(
        doc("@keyframes tint { from { color: #ff0000; animation-timing-function: ease-in }"
            " to { color: #0000ff } }"
            ".box { animation-name: tint; }"));
    check(colour.color_stops.size() == 2, "two colour stops");
    check(colour.color_stops[0].easing_value == "ease-in",
          "the raw keyframe timing function is kept on the stop");

    std::vector<ColorKeyframe> stops = {{0.0f, Rgba{0, 0, 0, 255}, Easing{}},
                                        {1.0f, Rgba{100, 100, 100, 255}, Easing{}}};
    check(sample_color(stops, 0.5f).r == 50, "a linear colour stop is unchanged");
    stops[0].easing.kind = EasingKind::kSteps;
    stops[0].easing.steps = 2;
    check(sample_color(stops, 0.5f).r == 50, "steps(2, end) keeps the first half");
    check(sample_color(stops, 0.25f).r == 0, "steps(2, end) holds the from colour");

    const AnimationSpec move = parse_animation(
        doc("@keyframes move { from { transform: translate(0px, 0px); animation-timing-function: steps(2, end) }"
            " to { transform: translate(100px, 0px) } }"
            ".box { animation-name: move; }"));
    std::string value;
    check(sample_transform(move, 0.25f, value) && value == "translate(0px, 0px)",
          "a stepped transform holds the from value");
    check(sample_transform(move, 0.75f, value) && value == "translate(50px, 0px)",
          "a stepped transform jumps at the step boundary");
}

// --- animation-direction ---------------------------------------------------

void test_direction_reverse_and_alternate() {
    AnimationTiming timing;
    timing.duration_ms = 100;

    AnimationPhase phase = resolve_animation_phase(timing, 25.0);
    check(std::fabs(phase.progress - 0.25f) < 1e-4f && phase.active,
          "normal direction follows the timeline");

    timing.direction = AnimationDirection::kReverse;
    phase = resolve_animation_phase(timing, 25.0);
    check(std::fabs(phase.progress - 0.75f) < 1e-4f,
          "reverse plays the iteration backwards");
    phase = resolve_animation_phase(timing, 0.0);
    check(std::fabs(phase.progress - 1.0f) < 1e-4f,
          "reverse starts at the end of the iteration");

    timing.direction = AnimationDirection::kAlternate;
    timing.iteration_count = 2.0f;
    phase = resolve_animation_phase(timing, 75.0);
    check(std::fabs(phase.progress - 0.75f) < 1e-4f && phase.iteration == 0,
          "alternate plays the first iteration forwards");
    phase = resolve_animation_phase(timing, 125.0);
    check(std::fabs(phase.progress - 0.75f) < 1e-4f && phase.iteration == 1,
          "alternate plays the second iteration backwards");
    const AnimationSpec fade = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; }"));
    check(std::fabs(sample_opacity(fade, phase.progress) - 0.75f) < 1e-4f,
          "the alternate phase drives the sampled value");

    timing.direction = AnimationDirection::kAlternateReverse;
    phase = resolve_animation_phase(timing, 25.0);
    check(std::fabs(phase.progress - 0.75f) < 1e-4f,
          "alternate-reverse starts backwards");
    phase = resolve_animation_phase(timing, 125.0);
    check(std::fabs(phase.progress - 0.25f) < 1e-4f,
          "alternate-reverse plays the second iteration forwards");
}

// --- animation-fill-mode / animation-delay ---------------------------------

// none / backwards / forwards / both、reverse との組み合わせ、端数の反復。
void test_fill_mode_around_the_delay() {
    AnimationTiming timing;
    timing.duration_ms = 100;
    timing.delay_ms = 100;

    AnimationPhase phase = resolve_animation_phase(timing, 50.0);
    check(phase.before && !phase.applies,
          "fill-mode none leaves the element static during the delay");

    timing.fill_mode = AnimationFillMode::kBackwards;
    phase = resolve_animation_phase(timing, 50.0);
    check(phase.applies && std::fabs(phase.progress) < 1e-4f,
          "backwards fill paints the from value during the delay");

    timing.fill_mode = AnimationFillMode::kForwards;
    phase = resolve_animation_phase(timing, 50.0);
    check(!phase.applies, "forwards fill does not cover the delay");
    phase = resolve_animation_phase(timing, 200.0);
    check(!phase.active && phase.applies && std::fabs(phase.progress - 1.0f) < 1e-4f,
          "forwards fill keeps the to value after the animation");

    timing.fill_mode = AnimationFillMode::kBoth;
    phase = resolve_animation_phase(timing, 50.0);
    check(phase.applies && std::fabs(phase.progress) < 1e-4f,
          "both fill covers the delay");
    phase = resolve_animation_phase(timing, 250.0);
    check(phase.applies && std::fabs(phase.progress - 1.0f) < 1e-4f,
          "both fill keeps the end value");

    // A backwards fill of a reversed animation paints the 100% value.
    AnimationTiming reversed;
    reversed.duration_ms = 100;
    reversed.delay_ms = 50;
    reversed.direction = AnimationDirection::kReverse;
    reversed.fill_mode = AnimationFillMode::kBackwards;
    const AnimationPhase before = resolve_animation_phase(reversed, 10.0);
    check(before.applies && std::fabs(before.progress - 1.0f) < 1e-4f,
          "a backwards fill of a reversed animation paints the 100% value");

    // The forwards fill keeps the value the last partial iteration ended on.
    AnimationTiming fractional;
    fractional.duration_ms = 100;
    fractional.iteration_count = 2.5f;
    fractional.fill_mode = AnimationFillMode::kForwards;
    AnimationPhase last = resolve_animation_phase(fractional, 240.0);
    check(last.active && std::fabs(last.progress - 0.4f) < 1e-4f,
          "a fractional iteration count stays active until it runs out");
    last = resolve_animation_phase(fractional, 260.0);
    check(!last.active && last.applies && std::fabs(last.progress - 0.5f) < 1e-4f,
          "the forwards fill keeps the value the last partial iteration ended on");
}

// --- animation-iteration-count / timeline length ---------------------------

// 反復回数の解釈・タイムライン長・負の delay をまとめて確認する。
void test_iteration_count_and_timeline() {
    check(std::fabs(parse_iteration_count("3", 1.0f) - 3.0f) < 1e-4f,
          "a numeric iteration count is parsed");
    check(std::fabs(parse_iteration_count("0.5", 1.0f) - 0.5f) < 1e-4f,
          "a fractional iteration count is parsed");
    AnimationTiming infinite;
    infinite.iteration_count = parse_iteration_count("infinite", 1.0f);
    check(animation_iterations_infinite(infinite), "infinite is detected");
    check(std::fabs(parse_iteration_count("nope", 2.0f) - 2.0f) < 1e-4f,
          "an invalid iteration count keeps the fallback");
    check(std::fabs(parse_iteration_count("-2", 1.0f) - 1.0f) < 1e-4f,
          "a negative iteration count keeps the fallback");

    AnimationTiming timing;
    timing.duration_ms = 100;
    check(animation_timeline_ms(timing) == 100, "one iteration samples one duration");

    timing.iteration_count = 3.0f;
    check(animation_timeline_ms(timing) == 300, "three iterations triple the timeline");

    timing.iteration_count = 2.5f;
    check(animation_timeline_ms(timing) == 300, "a fractional count rounds up to a whole iteration");

    timing.iteration_count = std::numeric_limits<float>::infinity();
    check(animation_timeline_ms(timing) == 100, "an infinite animation samples one iteration");
    timing.direction = AnimationDirection::kAlternate;
    check(animation_timeline_ms(timing) == 200,
          "an infinite alternate animation samples two iterations");

    timing.delay_ms = 250;
    timing.iteration_count = 2.0f;
    check(animation_timeline_ms(timing) == 450, "the delay is added to the timeline");

    AnimationTiming negative;
    negative.duration_ms = 300;
    negative.delay_ms = -150;
    const AnimationPhase phase = resolve_animation_phase(negative, 0.0);
    check(phase.active && std::fabs(phase.progress - 0.5f) < 1e-4f,
          "a negative delay starts halfway through the iteration");
    check(animation_timeline_ms(negative) == 150,
          "the negative delay shortens the remaining timeline");
}

void test_direction_and_fill_parsing() {
    check(parse_animation_direction("reverse", AnimationDirection::kNormal) ==
              AnimationDirection::kReverse,
          "the reverse keyword is parsed");
    check(parse_animation_direction("alternate-reverse", AnimationDirection::kNormal) ==
              AnimationDirection::kAlternateReverse,
          "the alternate-reverse keyword is parsed");
    check(parse_animation_direction("reverse, normal", AnimationDirection::kNormal) ==
              AnimationDirection::kReverse,
          "the first list item is used");
    check(parse_animation_direction("sideways", AnimationDirection::kNormal) ==
              AnimationDirection::kNormal,
          "an unknown direction keeps the fallback");
    check(parse_animation_fill_mode("both", AnimationFillMode::kNone) ==
              AnimationFillMode::kBoth,
          "the both keyword is parsed");
    check(parse_animation_fill_mode("forwards", AnimationFillMode::kNone) ==
              AnimationFillMode::kForwards,
          "the forwards keyword is parsed");
    check(parse_animation_fill_mode("sideways", AnimationFillMode::kNone) ==
              AnimationFillMode::kNone,
          "an unknown fill mode keeps the fallback");
}

// longhand / shorthand の timing 捕捉とカスケード。
void test_timing_longhands_and_shorthand() {
    const AnimationSpec spec = parse_animation(
        doc("@keyframes fade { from { opacity: 0 } to { opacity: 1 } }"
            ".box { animation-name: fade; animation-duration: 2s; animation-delay: 300ms;"
            " animation-iteration-count: 4; animation-direction: alternate;"
            " animation-fill-mode: both; }"));
    check(spec.timing.duration == "2s", "the duration longhand is captured");
    check(spec.timing.delay == "300ms", "the delay longhand is captured");
    check(spec.timing.iteration_count == "4", "the iteration count longhand is captured");
    check(spec.timing.direction == "alternate", "the direction longhand is captured");
    check(spec.timing.fill_mode == "both", "the fill mode longhand is captured");

    const AnimationTimingDecl timing =
        find_animation_timing("animation: fade 1s ease-in-out 2 alternate both 100ms;");
    check(timing.duration == "1s", "the shorthand duration is the first time");
    check(timing.delay == "100ms", "the second time is the delay");
    check(timing.iteration_count == "2", "the unitless number is the iteration count");
    check(timing.direction == "alternate", "the direction keyword is captured");
    check(timing.fill_mode == "both", "the fill keyword is captured");
    check(timing.timing_function == "ease-in-out", "the timing function is captured");
    // A later longhand overrides the shorthand component it names.
    const AnimationTimingDecl overridden =
        find_animation_timing("animation: fade 1s ease-in; animation-direction: reverse;");
    check(overridden.direction == "reverse", "a longhand overrides the shorthand");
    check(overridden.timing_function == "ease-in",
          "an unnamed shorthand component is kept");
}

}  // namespace

int main() {
    test_opacity_stops();
    test_transform_stops();
    test_transform_mismatch_and_unsupported();
    test_keyframes_binding();
    test_color_stops();
    test_colour_interpolation();
    test_frame_schedule();
    test_var_stop_values_are_kept_raw();
    test_resolved_stop_values_are_rebuilt();
    test_animation_duration();
    test_find_animation_duration_of_a_declaration_block();
    test_per_keyframe_easing_is_applied();
    test_element_timing_function_and_keyframe_override();
    test_cubic_bezier_and_steps_evaluation();
    test_eased_colour_and_transform();
    test_direction_reverse_and_alternate();
    test_fill_mode_around_the_delay();
    test_iteration_count_and_timeline();
    test_direction_and_fill_parsing();
    test_timing_longhands_and_shorthand();
    std::printf("%s\n", g_fail == 0 ? "ALL PASS" : "SOME FAILED");
    return g_fail == 0 ? 0 : 1;
}
