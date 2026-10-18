# 複数ページ PDF (P1: Layout-once + Slice)

単一 HTML を複数ページの PDF にする P1 実装と検証の記録。oracle 設計 (Layout-once + Slice) 準拠。

## 実装

- 新規 `renderHtmlToPdf` (`src/cpp/renderers/pdf_renderer.cpp` / `.h`):
  1. `contentWidth` で **1 回だけ** `doc->render()`。
  2. `doc->height()` から頁数を算出 (`ceil(docHeight / contentAreaHeight)`, 最低 1)。
  3. 頁ごとに `beginPage(width, pageHeight)` → 背景 rect → header/footer を頁ごとに再描画
     (`replace_template_vars`, 現行踏襲) → 本文を切り出し → `endPage`。
- 配線 (`src/cpp/api/satoru_api.cpp`):
  - `satoru_api_render` の PDF 分岐で `htmls.size() == 1` のとき新パスへ。
  - `htmls.size() >= 2` は従来の `renderHtmlsToPdf` (1 要素 = 1 頁) を維持。
  - `satoru_api_html_to_pdf` も新パスへ。
- `pageHeight = height(>0) : options.outputHeight(>0) : 既定 A4 96dpi = 1123`。
- `contentAreaHeight = pageHeight - pdfMarginTop - pdfMarginBottom` (最低 1 にクランプ)。
- CSS 追加なし・litehtml レイアウト改造なし。

## 実装メモ (設計上の判断)

- 頁シフトは **canvas translate ではなく `doc->draw` の y オフセット**で与える。
  litehtml は `position:fixed` を `draw(hdc, 0, 0, ...)` で描画し y オフセットを無視する
  (`render_item.cpp`)。これにより fixed は全頁で同一位置へ再描画される (要件どおり)。
  頁境界の切出しは `canvas->clipRect` で行う。
  (`doc->draw` の clip 引数に頁シフト済み矩形を渡すと fixed が 2 頁目以降で cull されるため
  clip には `nullptr` を渡し、実クリップは canvas 側で行う。)
- レイアウトコンテナは `reset()` + `set_canvas()` で頁ごとに再利用 (文書は再構築しない)。
- vh / メディア機能の高さは `contentAreaHeight`。

## 検証 (Chromium 対照)

`verify.mts` が固定 HTML を wasm エンジンで PDF 化し、Chromium (Playwright 同梱 1248) の
`page.pdf()` (幅 600px, 高さ 1123px, 余白 0) と頁数・連結テキストを比較する。
エンジン PDF は独自の軽量パーサで読み (Skia はページ辞書を非圧縮で書く)、
Type3 フォントの `ToUnicode` CMap を引いて各頁のテキストを連結する。

```bash
cd packages/visual-test
npx tsx pdf-pagination/verify.mts
```

結果:

| case  | engine 頁数 | Chromium 頁数 | 連結テキスト (空白除去) | 頁スライス |
|-------|------------|--------------|------------------------|-----------|
| short | 1          | 1            | 一致                   | -         |
| long  | 3          | 3            | 一致                   | 重複なし  |
| image | 2          | 2            | 一致                   | 重複なし  |

- long: engine p1 `"Long Docblock oneblock two"` / p2 `"block three"` / p3 `"Tail line end"`
  → 頁ごとに重複なく切断できている。
- header/footer: 各頁に `Page N` / `total 3` が再描画される (bottom margin 40 で確認)。
- `position:fixed`: 全 3 頁に `FIXEDMARK` が出る。
- 連結テキストは空白除去で比較する。Chromium の `innerText` はブロック境界に改行/空白を
  挿入するが、エンジンはグリフ列をそのまま連結するため (文字種の差は無い)。

## 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。
- `output-size.test.ts` の PDF 自動高テスト (既定 pageHeight 1123 > 900) と
  明示高テスト (pageHeight 300 = 第 1 頁 MediaBox 高) は新挙動でも通過。

## 制限 (P1 スコープ内で記録)

- **改ページは「ピクセル切断」**: litehtml に `break-*` / `avoid-*`・orphans/widows が無いため、
  行・要素・画像の途中でもそのまま切れる。切断許容 (要件どおり)。
- **`position:sticky` 未対応**: litehtml の `element_position` は static/relative/absolute/fixed のみ
  (`types.h`)。sticky は通常フローとして 1 回だけ描画される (暫定。先頭頁に固定表示ではない)。
- **配列入力 (`htmls` 2 件以上) は従来どおり 1 要素 = 1 頁**。単一 HTML の頁分割とは別経路。
- **描画コストは頁数分**: 各頁で文書全体を `draw` し canvas clip で切り出す (再レイアウトは無いが、
  クリップ外も draw される。culling は canvas clip のみ)。
- **footer の既定位置**: `pdfMarginBottom = 0` のとき footer は `y = pageHeight` に置かれ頁外
  (不可視)。配置式は現行 `renderHtmlsToPdf` を踏襲したもので、新規の制限ではない。

## スコープ外 (P1 対象外)

- 明示的な改ページ CSS、sticky、表/行の分割制御。
- 配列経路の頁分割。
