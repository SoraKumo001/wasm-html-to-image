#pragma once
// Shim: litehtml (include/litehtml/render_item.h, flex_item.h) が
// `#include "../../../core/logical_geometry.h"` で要求する相対パスを
// 正本 `src/cpp/core/logical_geometry.h` へ転送するための薄い中継。
// litehtml自体は改変禁止のためこの中継のみを追加。正本の実体は
// `src/cpp/core/logical_geometry.h` (ガード HTML_TO_IMAGE_LOGICAL_GEOMETRY_H)。
#include "../../core/logical_geometry.h"
