# Grid track sizing: Blink vs. render_grid.cpp

Reference only (no Blink code is copied). Source read: `third_party/blink/renderer/core/layout/grid/grid_track_sizing_algorithm.cc`
(chromium/chromium main). The spec is CSS Grid 2 §12.3-12.8; Blink follows it step by step.

| Blink (`ComputeUsedTrackSizes`) | `render_grid.cpp` today | Gap |
|---|---|---|
| 1 InitializeSets: base size / growth limit per track | first pass over `columns_template` (fixed, minmax min as base, fr counted) | content tracks (auto/min/max/fit-content) are classified later (`kinds`), in a second pass |
| 2 ResolveIntrinsicTrackSizes: items sorted by span; five contribution types per group (intrinsic mins, content-based mins, max-content mins, intrinsic max, max-content max); items spanning a flex track last | `kinds` loop: **only single-column items**; max-content contribution, plus an ad hoc `minc` shrink when the tracks overflow | spanning items never size auto/min/max-content tracks; no per-type contributions |
| 3 MaximizeTracks: free space shared equally into base sizes up to growth limits | `maximize_definite_minmax` (definite minmax only); auto tracks get `remaining / autos` when there is no fr | auto and fit-content tracks are not grown up to their limit generally |
| 4 ExpandFlexibleTracks / FindFrSize: definite space -> leftover / flex sum (**sum clamped to >= 1**, tracks whose base exceeds their share restart as inflexible); indefinite space -> max over spanning items of FindFrSize(item max-content contribution) and over tracks of base / min(factor, track count) | `resolve_flex_tracks` (definite; same freeze rule, sum clamped since this change) and the `content_inline` branch (indefinite: max of item contribution / factor) | the indefinite branch ignores items spanning several flex tracks and the `min(factor, track_count)` rule; plain fr tracks get a floor only from items with a definite width / min-width (text min-content is not trusted) |
| 5 StretchAutoTracks (justify-content normal/stretch) | the `remaining / autos` branch | only when there is no fr track |

Not mirrored: subgrid, auto-repeat intrinsic pass (`needs_intrinsic_track_size`), baseline-shared sets, min/max available-size re-run (a TODO in Blink too).

Found by reading it: a flex-factor sum below 1 is treated as 1 (`0.25fr 0.25fr` over 600px -> 150 + 150, not 300 + 300).
