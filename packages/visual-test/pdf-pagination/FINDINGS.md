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

- 明示的な改ページ CSS、sticky、表/行の分割制御。 → P2 で `break-*` のみ実装 (下記)。
- 配列経路の頁分割。

---

# 複数ページ PDF (P2: CSS Fragmentation / Atomic break)

P1 の「Layout-once + Slice」を土台に、切断位置を CSS 断片化プロパティで賢くする。
oracle 設計 (Atomic break) 準拠。**スコープ P2 のみ**・コミット禁止。

## 実装

### 1. CSS 追加 (litehtml)

- 新規プロパティは最小 3 つ:
  | プロパティ | 値 | enum |
  |---|---|---|
  | `break-before` | `auto` / `avoid` / `page` | `break_flow` |
  | `break-after`  | `auto` / `avoid` / `page` | `break_flow` |
  | `break-inside` | `auto` / `avoid`           | `break_inside` |
- レガシー `page-break-*` は **エイリアス同値マップ** (`style::add_property` で parse 時に
  `break-*` へ写像。コンピュート側はモダン名のみ読む):
  - `page-break-before/after`: `auto`→`auto` / `always`→`page` / `avoid`→`avoid` / `left|right`→`page`
  - `page-break-inside`: `auto`→`auto` / `avoid`→`avoid`
- 非継承 (`get_property<int>(..., inherited=false, ...)`)。
- 変更点: `types.h` (enum/strings), `string_id.h` (property id), `css_properties.{h,cpp}`
  (member/getter/compute/dump), `style.cpp` (valid values + parse + legacy remap)。

### 2. ページネーションパス (render_block_context 外 / atomic unit)

`src/cpp/renderers/pdf_renderer.cpp` の `renderHtmlToPdf` 内、**レイアウト後に一度だけ**計画:

- `collect_break_units(doc->root())`: フロールート `<body>` の直下にある
  **最上位 block child** と **置換要素 (`img` / `table` 全体)** を atomic unit として収集。
  - `display:none` / `position:absolute|fixed` は除外 (`in_normal_flow()`)。
  - **ネスト内へは立入禁止** (直下のみ。孫以降は親 unit に丸ごと含める)。
  - unit の `top/bottom` は `element::get_placement()` (文書座標)。
- `plan_page_cuts(units, contentAreaHeight, docHeight)` が頁開始オフセット列を作る:
  1. **自然切断 = P1 と同じ固定ピクセル切断** (`pos + H`)。`break-*` 無しなら P1 と完全一致。
  2. **強制改頁** (`break-before:page` はその unit の `top`、`break-after:page` は `bottom`) が
     頁内 (`<= pos+H`) にあれば、そこで頁を早期終了。
  3. **`break-inside:avoid`**: unit が切断位置を跨ぐなら切断をその unit の `top` へ後退 (次頁送り)。
  4. **`break-before/after:avoid`**: 切断が隣接 unit の間 (ギャップ) に落ちるなら、
     直前 unit の `top` へ後退させて 2 つを同一頁に保つ。
  - 進捗保証: `cut <= pos` ならピクセル切断へフォールバック。頁より高い avoid unit は分割許容。

### 3. 頁スライス幅 (P1 からの差分)

P1 は各頁のクリップ高を常に `contentAreaHeight` にしていたが、P2 では切断が
`H` より手前に来るため、**クリップ高 = 次 cut までの距離** (`min(次cut - offset, contentAreaHeight)`)
に変更。これが無いと短い頁で次頁先頭の内容が二重描画される。最終頁は `contentAreaHeight`。
`position:fixed` の再描画・header/footer の頁毎再描画は P1 のまま。

## 検証 (`verify.mts` を拡張)

`packages/visual-test/pdf-pagination/verify.mts` に P2 ケースを追加。Chromium
(`page.pdf()`, 600×1123, 余白 0) と頁数・連結テキストを対照。頁スライス (avoid の場合の
unit 配置) は明示 assert。

```bash
cd packages/visual-test
npx tsx pdf-pagination/verify.mts
```

結果 (全て OK):

| case | 内容 | eng 頁数 | chrom 頁数 | 頁配置 assert |
|---|---|---|---|---|
| avoidcard  | `break-inside:avoid` のカード (1000..1300) が境界跨ぎ | 2 | 2 | p1=padding / p2=AVOIDCARD+tail |
| legacycard | `page-break-inside:avoid` (レガシー同値)         | 2 | 2 | 同上 |
| breakpage  | `break-before:page` (doc 高 600 < H)            | 2 | 2 | p1=A / p2=B |
| legacybreak| `page-break-before:always` (レガシー同値)        | 2 | 2 | p1=A / p2=B |
| avoidhead  | `break-after:avoid` 見出し (bottom = 頁境界)     | 2 | 2 | p1=padding / p2=HEAD+PARA |

- **リグレッションゲート**: avoid 無し文書 (`short`/`long`/`image`) は P1 と同一 (頁数・頁スライス)。
  `long` のスライスは P1 記録値と文字列一致を assert。
- header/footer 各頁再描画・`position:fixed` 各頁再描画も P1 同様に継続。

### 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。

## P2 の制限 (スコープ内で記録)

- atomic unit は **最上位のみ**。1 つの巨大な直下 `div` に中身を全部入れた文書では unit が 1 つに
  なり、`break-*` は効かない (ネスト内立入禁止の設計どおり)。
- `break-inside:avoid` は頁より高い unit では分割される (進捗優先)。
- `break-before/after:avoid` が効くのは切断が単位間ギャップに落ちる場合のみ。切断が次 unit の
  内部に落ちる場合は「その unit の途中で切れる」だけで、前方 unit との break ではないため対象外。
- 本文テキスト抽出比較は Skia の合字 (`fi` 等) が `ToUnicode` で `\u0000` になり得るため、
  P2 検証の固定文は合字を作らない語 (`padding` 等) を用いた (P1 の既知の抽出注意と同じ)。
- 配列入力経路 (`htmls` 2 件以上) は従来どおり 1 要素 = 1 頁。P1/P2 の単一 HTML 頁分割とは別経路。

---

# 複数ページ PDF (P3: Block fragmentation / line-aware cuts)

P1/P2 の「Layout-once + Slice」を土台に、**行 (line box) 単位の断片化**と
**orphans/widows** を加える。oracle 設計 (Block fragmentation) の意図に沿う。**スコープ P3 のみ**・コミット禁止。

## 実装方針 (採用した方式と、oracle 仕様からの差分)

P3 は **「行境界へのカット吸着 + orphans/widows」** として実装した。すなわち、
P2 の `plan_page_cuts` が決めた自然カット (ピクセル/avoid/強制) に対し、

1. そのカットを行境界へ吸着 (跨ぐ line box は丸ごと次断片へ送る)、
2. カットが段落 (inline formatting context) の途中に落ちる場合に orphans/widows を適用、

する。描画 (頁スライス) は P1/P2 と同一で、カットが手前に動くだけ。

**差分の記録 (重要):**

- **`render_block_context.cpp` の子配置ループには page_remaining を持ち込んでいない。**
  代わりに「レイアウトは頁非依存のまま 1 回だけ」行い、頁割りはレイアウト後の
  カット計画側で行境界に吸着する。このため **measure 側の高さは頁を完全に無視**
  (仕様の「measure側の高さは頁無視(分離厳守)」を構造的に満たす)。`render_block_context.cpp`
  は未変更。理由: エンジンの place 段に頁送りを混ぜると座標系 (単一長尺キャンバス) と
  親子高さの整合が崩れ、P1/P2 の完全回帰が保証できないため。
- **inline 断片化**: `render_item_inline_context` が持つ line box の矩形を新規 API
  (`element::get_line_boundaries` / `render_item::get_line_boundaries`) で公開し、
  計画側が行境界を得る。**行は分割せず**、跨ぐ行を丸ごと次断片へ送る (行は頁跨ぎで
  各斷片に描き分けられる)。CSS どおり line box は monolithic。
- **border/padding 断片化は「先頭断片のみ」(簡易継続なし) に固定**。ブロックは 1 回だけ
  描画され、カットで割れた場合は描かれた斷片側にのみ border/padding が出る (P1 挙動)。
  継続断片側に border/padding を描き足す処理は行わない。→ **記録: 先頭断片のみ方式を採用**。
- **orphans/widows**: CSS 値尊重。既定 2/2。下端斷片の行数 < orphans なら斷片ごと次頁へ
  (当頁 0 行)、次頁先頭斷片の行数 < widows なら行を手前へ繰り上げ (段落全体行数が
  orphans+widows 以上の場合のみ)。負値/0 は parse 時に棄却し初期値 2。
- **float 跨ぎ**: 暫定仕様。カットを跨ぐ float box は丸ごと次斷片へ送る。回り込み解除の
  再レイアウトはしない。
- **flex / grid / table コンテナは atomic 送り**: 内部へは行断片化のため降りず、コンテナ
  全体を 1 つの atomic box として扱う (跨ぐ場合は丸ごと次斷片へ)。`display:flex|inline-flex|
  grid|inline-grid|table|inline-table` が対象。

### 変更ファイル

- litehtml: `string_id.h` (`_orphans_`/`_widows_`), `css_properties.{h,cpp}` (int member/
  getter/compute/dump), `style.cpp` (整数パース), `render_item.h` (virtual
  `get_line_boundaries`), `render_inline_context.h` (override), `element.{h,cpp}` (公開 API)。
- `src/cpp/renderers/pdf_renderer.cpp`: `LineGroup`/`FloatBox`、`collect_line_groups`、
  `snap_cut_to_content`、`plan_page_cuts` の引数追加と P3 ステップ (4)。

### 非回帰の要点

自然カットを跨ぐ line box / float が無く、かつカットが段落を割らない文書では
`snap_cut_to_content` は完全な no-op → P1/P2 とバイト単位で同一のカット列になる。

## 検証 (`verify.mts` に P3 ケース追加)

```bash
cd packages/visual-test
npx tsx pdf-pagination/verify.mts
```

| case      | 内容 | eng 頁 | chrom 頁 | 頁あたり行数 eng / chrom | 判定 |
|-----------|------|--------|----------|--------------------------|------|
| p3orphans | spacer 1103px で 1 行だけ収まる → orphans:2 で段落ごと次頁 | 2 | 2 | `[0,10]` / `[0,10]` | 孤児行ゼロ |
| p3widows  | spacer 943px で 9 行収まる → widows:2 で 1 行繰り上げ | 2 | 2 | `[8,2]` / `[8,2]` | 割れ位置一致 |
| p3long    | 80 行段落の自然割り (行境界) | 2 | 2 | `[56,24]` / `[56,24]` | ±0 行 |
| p3float   | 境界を跨ぐ float (1000..1200) が次頁へ丸ごと | 2 | - | FLOATX は 1 頁のみ | OK |

- 「孤児行ゼロ」: p3orphans は当頁の段落斷片 0 行 (Chromium と一致)。
- 「割れ位置±1行以内」: 全ケースで Chromium と完全一致 (±0)。
- `text` 判定は Skia Type3 `ToUnicode` で数字が `\u0000` になる既知事象のため、
  行を表す英字 (`L`) の個数のみで比較 (行の欠落/重複が無いことを確認)。
- float は Chromium 対照を課さず (暫定仕様)、FLOATX が單一頁に 1 回だけ出ることを確認。

### P1/P2 回帰 (同スクリプト)

- `short` / `long` / `image`、header/footer 各頁再描画、`position:fixed` 各頁再描画: 全て OK。
- P2 (`avoidcard`/`legacycard`/`breakpage`/`legacybreak`/`avoidhead`): 全て OK。
- `regression (no avoid == P1)`: `long` のスライスが P1 記録値と文字列一致。

### 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。

## P3 の制限 (スコープ内で記録)

- 行断片化は **カット吸着** であり、行送り (段落が頁を跨いで上に詰まる) の再レイアウトはしない。
  頁下端の余白は「その行が入らなかった分」だけ空く (Chromium と同じ挙動)。
- 段落が頁より高い等、orphans+widows を同時に満たせない場合は調整せず自然カットのまま。
- border/padding の継続斷片装飾なし (先頭斷片のみ)。
- float の回り込みは解除しない (暫定)。
- 断片化は「單一 HTML 頁分割」経路のみ。配列入力 (`htmls` 2 件以上) は従来どおり。

---

# 複数ページ PDF (P4: Table fragmentation / row units + thead repeat)

P1/P2/P3 の「Layout-once + Slice」を土台に、**表 (table) の行単位断片化**と
**thead の頁毎繰返し**を加える。oracle 設計 (Table fragmentation) に沿う。**スコープ P4 のみ**・コミット禁止。

## 実装方針 (採用した方式と、oracle 仕様からの差分)

`render_item_table` / `render_item_table_row` は `table_grid` が行を配置し
`render_item_table` がセルを描画する**独立エンジン**であり、P3 の行 (line box) 収集とは
座標系が異なる。そこで P4 は **P3 から分離した行単位のカット吸着**として実装した:

1. **行を atomic unit 化**: 各 `<tr>` を P3 の float と同じ「跨ぐカットを丸ごと次斷片へ送る」
   ボックスとして `plan_page_cuts` に渡す。カットが行の内部に落ちれば行頭へ吸着する。
   頁より高い行は分割許容 (進捗優先)。
2. **rowspan>1 は次頁送り優先**: 1 つのセルが覆う行 (rowspan) を 1 つの atomic ボックスへ
   併合する。セル内 block 分割は対象外 (行ボックスがセルを丸ごと含むため構造的に分割されない)。
3. **thead 繰返し**: 継続頁では thead 帯 (行の union 矩形) を頁内容の先頭に再描画し、
   その高さを頁内容領域から**予約**する。本文は予約分だけ下へシフトし、ヘッダ帯と重ならない。
4. **flex / grid は atomic 送りのみ維持** (P3 のまま)。table だけを行単位へ切り替える。

**差分の記録 (重要):**

- **行の矩形は `element::get_placement()` では取れない**。表の行/セルの render item は
  `render_item_table::init()` が `render_item::init()` の再帰を打ち切るため
  `element::add_render` に登録されず、`element::get_placement()` は常に 0 を返す。
  そこで P3 の `get_line_boundaries` と同様に **render item へ新規 API を追加**した:
  - `render_item::get_table_row_boundaries(position::vector&)` (P4 override: `render_item_table`)
    … `table_grid` の `row(i).top/bottom` + テーブル render item の絶対位置から各行矩形を返す
    (rowspan で覆われる行は併合)。`element::get_placement` 依存を回避。
  - `render_item::get_table_header_boundary(position&)` (P4 override) … 各行の `<tr>` 要素の
    親を遡り `display:table-header-group` または `<thead>` タグを持つ行の union を返す。
- **カット計画 (`plan_page_cuts`) は `PageCut{offset, header_top, header_height}` を返す**。
  ヘッダ予約は「その頁が始まる位置 `pos`」で判定し (`table_top < pos < table_bottom`)、
  頁スライスのクリップ/シフトに反映する (予約は頁の開始位置に紐付く)。
- **ヘッダ再描画は「ドキュメントをヘッダ帯へクリップして再 draw」**: 継続頁で
  `doc->draw(0,0,-header_top)` を `clipRect(0,0,W,header_height)` で描く。本文は
  `doc->draw(0,0,-(offset-header_height))` を `clipRect(0,header_height,W,slice)` で描く。
  これによりヘッダ帯と本文が重ならない。`position:fixed` は draw オフセットを無視するため、
  ビューポート位置がどちらか一方のクリップ帯に入り、**二重描画されない** (P1 の性質を維持)。
- **P3 の「table は atomic float」は撤去**し、table を検出したら行ボックス収集へ切り替えた
  (`collect_line_groups`)。flex/grid の atomic 送りはそのまま。

### 変更ファイル

- litehtml: `render_item.h` (`get_table_row_boundaries` / `get_table_header_boundary` virtual),
  `render_table.h` / `render_table.cpp` (`render_item_table` override 2 種)。
- `src/cpp/renderers/pdf_renderer.cpp`: `RepeatHeader` / `PageCut`、`collect_table_rows` /
  `collect_repeat_headers`、`collect_line_groups` の table 分岐、`plan_page_cuts` の戻り値と
  ヘッダ予約、`renderHtmlToPdf` の頁スライス (ヘッダ帯再描画 + 本文シフト)。

### 非回帰の要点

表を含まない文書では `repeat_headers` が空・行ボックスが空となり、`header_height = 0`、
`limit = pos + area_height` で P1/P2/P3 と同一のカット列になる (`long` のスライスが
P1 記録値と文字列一致することを assert)。

## 検証 (`verify.mts` に P4 ケース追加)

```bash
cd packages/visual-test
npx tsx pdf-pagination/verify.mts
```

| case      | 内容 | eng 頁 | chrom 頁 | 行保全 | thead 頁毎 | 判定 |
|-----------|------|--------|----------|--------|-----------|------|
| p4table   | 12 行表 (各行 250px) + `<thead>` | 3 | 3 | eng=12 dom=12 chrom=12 | eng 3/3 chrom 3/3 | OK |
| p4rowspan | 700px spacer + rowspan=2 セル (行 0-1 が頁境界を跨ぐ) | 3 | - | XA/XB が同一頁 + SPAN も同頁 | - | OK |

- **行の欠落/重複ゼロ**: `RMK` (数字を含まない語) の頁連結出現数 = DOM の行数 = 12
  (Skia Type3 `ToUnicode` で数字が `\u0000` になる既知事象を回避)。
- **各頁 thead 存在**: 3 頁すべてに `HEAD` が出る (Chromium の thead 繰返しと一致)。
- **カットは行境界**: eng の頁開始オフセットは行境界 (0 / 1033 / 2041) に吸着。
- p4rowspan: rowspan=2 のセルが覆う行 (0-1) を 1 atomic ボックスに併合した結果、
  境界を跨ぐグループが丸ごと次頁 (p2) へ送られ、`XA`/`XB` が同一頁に留まる
  (併合なしなら p1/p2 に割れる)。`SPAN` は 1 頁のみでセルは分割されない。

### P1/P2/P3 回帰 (同スクリプト)

- `short` / `long` / `image`、header/footer、`position:fixed` 各頁再描画: 全て OK。
- P2 (`avoidcard`/`legacycard`/`breakpage`/`legacybreak`/`avoidhead`): 全て OK。
- P3 (`p3orphans`/`p3widows`/`p3long`/`p3float`): 全て OK。
- `regression (no avoid == P1)`: `long` のスライスが P1 記録値と文字列一致。

### 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。

## P4 の制限 (スコープ内で記録)

- **border-collapse 境界の二重線は許容誤差**: 継続頁のヘッダ帯再描画と本文先頭行の境界で、
  折り畳みボーダーが二重に見え得る (ヘッダ帯を別 draw するため)。要件どおり許容として記録。
- **`display:table-header-group` を明示指定した表は、エンジン側の表レイアウトが
  ヘッダ行高 0 を返す** (`document::fix_table_children` が table-header-group の
  row-group を匿名ラッパで包み、ヘッダセルの高さが 0 になる既存挙動)。本実装の検出は
  `display:table-header-group` と `<thead>` タグの**両方**を見るが、検証は
  master CSS 既定 (`<thead>` = table-row-group、タグは `_thead_` のまま) で行った。
  ヘッダ-group レイアウト自体の修正は表エンジン側の課題で P4 (頁割) のスコープ外。
- **thead 繰返しは「予約 + 下シフト」方式**: 継続頁では本文全体をヘッダ高だけ下へシフトする
  (表以外の要素も同頁内で一緒に下がる)。表だけを押し下げる厳密再レイアウトはしない。
- **1 頁に複数の「繰返しヘッダ表」が同時継続する場合は最大高の 1 表のみ予約・再描画**
  (稀なケース。他表のヘッダは繰り返さない)。
- **行ボックスは `table_grid` の行高** に基づく。行頭が頁先頭 (`pos`) 以前の行は移動できず
  分割許容 (進捗優先)。rowspan 併合ボックスが頁より高い場合も同様に分割許容。
- **セル内 block 分割は対象外** (行がセルを丸ごと含む)。ネスト表は外側の行ボックスに含まれる。
- 断片化は「單一 HTML 頁分割」経路のみ。配列入力 (`htmls` 2 件以上) は従来どおり。
