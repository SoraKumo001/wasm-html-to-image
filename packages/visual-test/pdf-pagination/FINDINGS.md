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
  → P6 (footer 帯の自動確保) で、footer 高が bottom margin を超える場合のみ帯を確保して解消。

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

- `collect_break_units(doc->root())`: フロールート `<body>` の子から
  **block box** と **置換要素 (`img` / `table` 全体)** を atomic unit として収集。
  - `display:none` / `position:absolute|fixed` は除外 (`in_normal_flow()`)。
  - **グループ化ラッパーは透過** (c9ea82a): `display:block`・通常フロー (非 float)・
    自身の `break-*` 無し・自身の行 box 無し (テキスト/インライン内容なし)・
    子がすべて通常フローの block box / 置換要素、の box は unit にせず子を再帰解決する。
    これにより素の `<div>` で包んだカード内の `break-inside:avoid` 等が Chromium 同様に効く。
  - **内側優先**: ラッパーが透過なら内側の box だけが unit になり、box が atomic なら
    その subtree は走査しない。親子が二重に unit 化されることはない。
  - atomic のまま残る条件: 自身のインライン内容を持つ / flex・grid・table・list-item など
    独自の整形コンテキスト / 置換要素 / 自身が `break-*` を宣言。
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
| nestcard   | 素の `<div>` ラッパー内の `break-inside:avoid` カード (1000..1300) | 2 | 2 | p1=padding / p2=WRAPCARD+tail |
| nest2card  | 2 段ラッパー内の avoid カード (900..1250)        | 2 | 2 | p1=padding / p2=DEEPCARD (unit は 1 回のみ) |
| nestbreak  | ラッパー内 `break-before:page` (doc 高 600 < H)  | 2 | 2 | p1=A / p2=NESTB |

- **ネストケース (c9ea82a)**: グループ化ラッパーが透過し、内側の `break-*` が単位として
  解決されることを確認。`nest2card` は 2 段透過後も内側 unit が頁 2 へ送られること
  (透過が 1 段で止まらないこと) を確認する。

- **リグレッションゲート**: avoid 無し文書 (`short`/`long`/`image`) は P1 と同一 (頁数・頁スライス)。
  `long` のスライスは P1 記録値と文字列一致を assert。
- header/footer 各頁再描画・`position:fixed` 各頁再描画も P1 同様に継続。

### 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。

## P2 の制限 (スコープ内で記録)

- atomic unit の解決は **グループ化ラッパー透過 + 内側優先** (c9ea82a)。透過するのは
  自身の行 box を持たず、通常フローの block 子だけをまとめる `display:block` かつ
  自身の `break-*` 無しの box のみ。テキスト/インライン内容を持つ box、flex/grid/table/
  list-item、置換要素、自身が `break-*` を宣言した box は atomic のままで、**その内側の
  `break-*` は効かない** (中身を 1 つのテキスト入り `div` に詰めた文書では、その div 全体が
  1 unit のまま)。`break-*` が解釈されるのは **その box 自身が unit のとき**だけで、
  atomic box の内側に書いても無視される。
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
3. **thead 繰返し (2 パス描画)**: 継続頁では thead 帯 (行の union 矩形, 高さ `h`) を頁内容の
   先頭に再描画し、`h` を頁内容領域から**予約**する。本文は「全体を h 下へシフト」ではなく、
   **「表バンド」と「表以降バンド」の 2 回に分けて描く** (48cc86f):
   - **表バンド**: `clipRect(0, h, W, ...)` 内に、継続している表の部分だけを h 下へシフトして
     描く (`doc->draw(..., -(offset - h))`)。残りの行が再描画ヘッダに潜り込まない。
   - **表以降バンド**: 表の下端 (`table_bottom`) から頁末尾までを**シフトせず**描く
     (`doc->draw(..., -offset)`)。同頁の表以外の内容 (後続見出し・段落・画像など) は元の
     位置に留まる。
   - 帯の境界は `table_bottom` (継続表が複数なら `max(table_bottom)`)。表以降の内容がある
     場合のみ、表の閉じボーダーを残すため 2px 重ねる。両帯は頁を分割しているので
     `position:fixed` も自身のビューポート位置を含む帯で 1 回だけ描かれる (P1 の性質を維持)。
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
- **カット計画 (`plan_page_cuts`) は `PageCut{offset, header_top, header_height, table_bottom}`
  を返す**。ヘッダ予約は「その頁が始まる位置 `pos`」で判定し (`table_top < pos < table_bottom`)、
  頁スライスのクリップ/シフトに反映する (予約は頁の開始位置に紐付く)。`table_bottom` は
  その頁で継続している表の下端 (`max`、予約なしなら `INT_MAX`) で、表バンドが描ける範囲の
  終端になる。
- **ヘッダ再描画は「ドキュメントをヘッダ帯へクリップして再 draw」**: 継続頁で
  `doc->draw(0,0,-header_top)` を `clipRect(0,0,W,header_height)` で描く。本文は
  **表バンド** (`draw_band(h, table_end_rel, offset - h)`) と **表以降バンド**
  (`draw_band(table_end_rel, slice_height, offset)`) に分けて描く。これによりヘッダ帯と
  本文、および表と後続内容が重ならない。`position:fixed` は draw オフセットを無視するため、
  ビューポート位置を含むクリップ帯 1 つにだけ入り、**二重描画されない** (P1 の性質を維持)。
- **表以降の内容の有無はフロー内容で判定** (`content_starts_in`): `break_units` / 行頭
  (`line_groups`) / `float_boxes` の top が `[table_bottom, slice_end)` に入るかで見る。
  表後の body マージンだけの場合は「後続内容なし」とし、表バンドを `table_end_rel + h` まで
  広げて最終行を切らない。
- **P3 の「table は atomic float」は撤去**し、table を検出したら行ボックス収集へ切り替えた
  (`collect_line_groups`)。flex/grid の atomic 送りはそのまま。

### 変更ファイル

- litehtml: `render_item.h` (`get_table_row_boundaries` / `get_table_header_boundary` virtual),
  `render_table.h` / `render_table.cpp` (`render_item_table` override 2 種)。
- `src/cpp/renderers/pdf_renderer.cpp`: `RepeatHeader` / `PageCut` (`table_bottom`)、
  `collect_table_rows` / `collect_repeat_headers`、`collect_line_groups` の table 分岐、
  `plan_page_cuts` の戻り値とヘッダ予約 (継続表の `max(table_bottom)`)、
  `renderHtmlToPdf` の頁スライス (`draw_band` ラムダ + `content_starts_in` による
  ヘッダ帯/表バンド/表以降バンドの 2 パス描画)。

### 非回帰の要点

表を含まない文書では `repeat_headers` が空・行ボックスが空となり、`header_height = 0`、
`limit = pos + area_height` で P1/P2/P3 と同一のカット列になる (`long` のスライスが
P1 記録値と文字列一致することを assert)。

2 パス化 (48cc86f) は `header_height > 0` かつ `table_bottom < INT_MAX` の頁だけの分岐で、
それ以外は従来どおり単一バンド (`draw_band(0, slice_h, offset)`) で描く。表が頁途中で
終わる初回頁 (予約なし) と、継続頁に表以降のフロー内容が無い文書は、旧「全体 h シフト」
と同じ画になる (`table_bottom` 未記録時の防御分岐も旧挙動を維持)。

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
- **2 パス化 (48cc86f) の検証範囲**: 上表の 2 ケースは `p4table` = 表のみ (表以降の内容なし)、
  `p4rowspan` = thead 無し (繰返しヘッダ無し) のため、**「表以降バンド」を通らない**。
  したがって 2 パス化は上表の結果に影響しない経路であり、表バンド/表以降バンドの
  画素比較ケースは未追加 (下記「P4 の制限」の限界は実装からの帰結として記録)。

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
  → 後続対応で解消: 原因は `fix_tables_layout` の `table-row` 分岐が header/footer group 直下の
  行まで匿名 row-group (+匿名 table) で包んでいたこと。header/footer group を直接の子として
  受け入れ、行を header → 本文 → footer の順で grid へ登録するよう修正済み。
- **thead 繰返しは「予約 + 2 パス描画」方式**: 継続頁は「ヘッダ帯 h」+「表バンド」+
  「表以降バンド」の 3 帯で構成する。ヘッダ帯は元文書の表先頭 h px をオフセット 0 で、
  表バンドは文書 `[offset, min(offset+slice, table_bottom)]` を **h 下へシフト**して、表以降
  バンドは `[table_bottom, offset+slice]` を**非シフト**で描く。表だけを押し下げるので
  **同頁の表以外の内容は下がらない** (旧「本文全体を h 下へシフト」は 48cc86f で廃止)。
  ただし 1 回のレイアウトの斷片をずらして 2 回描いているだけなので、layout-once 由来の
  次の限界が残る (表以降の内容がある頁では、2 帯が重ならないよう表バンドの高さが h 分
  短くなる → 次項):
  - **表の最終行の下端 h px が欠ける**: 表が頁途中で終わり、かつ同頁に表以降のフロー内容が
    ある場合、表バンドは `table_end_rel` で止め、後続内容は非シフトで描く (重なり回避)。
    表は h 下へずれているため、表バンドが実際に描ける文書範囲は `table_bottom - h` までに
    なり、**表本体の最後の h px (行の下端・閉じボーダーを含み得る) はどの帯にも描かれない**。
    (その頁に残る表の高さが h 未満なら、表バンドは空になり残り行が丸ごと欠ける。)
    「表の残り + 後続内容」を素直に縦積みし直すレイアウト (Chromium) では生じない欠け。
  - **頁下端に余白が残る**: ヘッダ帯 h は頁全体の内容領域から予約されるため、カット計画は
    `limit = pos + area - h`、スライスは `avail = area - h` になる。**表以降の非シフト内容も
    頁下端 h px を使えない**。加えて表の行は atomic で行境界へ吸着するので、行が入らない
    分の余白に h が上乗せされ、継続頁の頁下端の空きが大きくなりやすい。「表が終わった後の
    残り領域へ後続内容を詰め直す」再レイアウトはしない。
  - **背景画像・グラデーションの継ぎ目**: ヘッダ帯 (表先頭 h px) と表バンド (cut 以降) は
    別 draw で、それぞれ異なる文書オフセットで描かれる。表やセルに `background-image`
    を敷くと、頁先頭 h px の下端で模様が (表先頭 → cut) に飛び、**連続しない継ぎ目**に
    なる。また表終端で表以降バンドへ切り替わる際は閉じボーダーを残すため 2px 重ねるので、
    その 2px は半透明背景が二重に合成される (不透明ならほぼ不可視)。
  - これらの限界は**継続頁だけ**に生じる。表が始まる頁 (予約なし) は単一バンドのまま。
- **1 頁に複数の「繰返しヘッダ表」が同時継続する場合は、最大高の 1 表のヘッダだけを再描画**
  し、シフト帯は継続する全表の `max(table_bottom)` まで広げる (他表のヘッダは繰り返さないが、
  残り行が再描画ヘッダに潜り込まないよう全表を h 下へずらす)。
- **行ボックスは `table_grid` の行高** に基づく。行頭が頁先頭 (`pos`) 以前の行は移動できず
  分割許容 (進捗優先)。rowspan 併合ボックスが頁より高い場合も同様に分割許容。
- **セル内 block 分割は対象外** (行がセルを丸ごと含む)。ネスト表は外側の行ボックスに含まれる。
- 断片化は「單一 HTML 頁分割」経路のみ。配列入力 (`htmls` 2 件以上) は従来どおり。

---

# 複数ページ PDF (P5: @page rule / page box)

P1-P4 の「Layout-once + Slice」を土台に、CSS `@page` の **`size` / `margin`** を
頁ジオメトリへ反映する。oracle 設計 (Polish 方式: litehtml を改造せず、頁描画の直前に
頁ボックスだけを整える) に沿う。**スコープ P5 のみ**・コミット禁止。

## 実装方針 (採用した方式)

litehtml は `@page` を解釈しない (`stylesheet.cpp` の at-rule switch で default →
`css_parse_error` で破棄)。そこで **PDF レンダラ (`pdf_renderer.cpp`) 側で
`@page` ブロックを走査・抽出** する。litehtml / API / bindings は未変更 (純増)。

1. **抽出元**: `master_css` + `user_css` (JS の `css` オプション → `scan_css` →
   `getExtraCss`) + HTML 内のインライン `<style>` ブロック (`extract_style_blocks`)。
   → `@page` をどの書式で書いても拾える。
2. **`size`**: 名前付きサイズ (`a3/a4/a5/b4/b5/letter/legal/ledger/tabloid`) または
   `<length>{1,2}`、任意の `portrait` / `landscape`。長さは 96dpi の CSS px に換算
   (`px/pt/pc/in/cm/mm/q`)。
3. **`margin`**: ショートハンド `<length>{1,4}` と `margin-top/right/bottom/left`。
4. **優先順位 (仕様どおり)**:
   - マージン: `@page margin` **>** `SatoruRenderOptions.pdfMargin*` (既存 API 互換のため
     `@page` を上書き推奨)。
   - 頁ボックス: `@page size` **>** `width` / `height` / `outputHeight` 引数。
   - `@page` の無い文書は完全に従来どおり (P1-P4 とバイト一致)。
5. **pt 変換**: SkPDF は MediaBox を pt で書く。`@page size` があるときだけ、頁を
   `px * 72/96` の pt で `beginPage` し canvas を `0.75` 倍する。これで `@page A4` が
   ブラウザと同じ A4 pt 寸法になる。`size` が無ければ従来の px-as-pt を維持
   (API 互換: `output-size.test` の「明示 height 300 → MediaBox 300」を壊さない)。

### テンプレート変数の判断 (counter(page) は拡張しない)

`{{pageNumber}}` / `{{totalPages}}` で **頁番号は既に足りている**。ヘッダ/フッタは頁ごとに
別 `document` として描画され、パース前に変数置換される (`replace_template_vars`)。
`counter(page)` / `counter(pages)` を CSS で使うには litehtml の generated content に
カウンタ機構を足す必要があり、既存の置換で得られる結果を超える価値が無い。
→ **counter 拡張は行わない** (YAGNI)。

### 変更ファイル

- `src/cpp/renderers/pdf_renderer.cpp` のみ:
  - `PageRule` / `css_length_to_px` / `named_page_size` / `parse_page_size` /
    `parse_margin_shorthand` / `parse_page_declarations` / `parse_page_rules` /
    `extract_style_blocks` (匿名 namespace)。
  - `renderHtmlToPdf`: `@page` 抽出、マージン/頁ボックスの決定、`@page size` 時の
    pt 変換 (`beginPage` 寸法 + `canvas->scale`)。
- litehtml / API / bindings / JS 変更なし。

## 検証 (`verify.mts` に P5 ケース追加)

```bash
cd packages/visual-test
npx tsx pdf-pagination/verify.mts
```

| case     | 内容 | 判定 |
|----------|------|------|
| p5a4     | インライン `<style>@page { size:A4; margin:20mm }</style>` | eng `595.00x842.00pt` / chrom `594.96x841.92pt` (±1pt 以内, OK)・頁数 eng=3 chrom=3 |
| p5land   | `@page { size: letter landscape }` | eng `792.00x612.00pt` (期待 792x612pt, OK) |
| p5margin | `css:"@page { margin: 100px 0 }"` + `pdfMargin:0` | 頁ボックス eng `600x1123pt` (size 無しは px-as-pt 維持)・頁数 3 (content area 923px) |

- **pt 一致**: Chromium は `page.pdf({ preferCSSPageSize: true })`。engine は整数 pt へ
  丸めるため差は 0.04〜0.08pt (許容 ±1pt)。A4 = 210×297mm = 595.28×841.89pt。
- **マージン優先**: p5margin は `@page margin` が `pdfMargin:0` を上書きしないと 2 頁に
  なる (923px 領域で 2000px 文書 → 3 頁)。3 頁であることが上書きの証明。

### P1-P4 回帰 (同スクリプト)

- `short` / `long` / `image`、header/footer 各頁再描画、`position:fixed` 各頁再描画: 全て OK。
- P2 (`avoidcard`/`legacycard`/`breakpage`/`legacybreak`/`avoidhead`): 全て OK。
- P3 (`p3orphans`/`p3widows`/`p3long`/`p3float`): 全て OK。
- P4 (`p4table`/`p4rowspan`): 全て OK。
- `regression (no avoid == P1)`: `long` のスライスが P1 記録値と文字列一致。

### 既存 vitest 回帰

- `packages/html-to-image` vitest **135 件 通過**。
- `packages/visual-test` vitest **155 件 通過**。

## P5 の制限 (スコープ内で記録)

- **bare `@page` のみ**。`:first` / `:left` / `:right` や名前付き頁 (`@page foo`) は
  抽出時に無視する (スコープ外)。同一 CSS 内に複数の bare `@page` があれば後勝ち。
- **`size` が無い `@page margin` は単位変換しない**: 頁ボックスは従来の `width` ×
  (height>outputHeight>1123) px-as-pt のまま。pt 換算は `size` 指定時のみ。
- **`size: auto` は無視** (名前付き/長さに一致しないため `has_size` は false)。
- マージンは `@page` が 1 つでも指定されれば **全辺を `@page` 値で確定** (未指定辺は 0)。
  一部長辺だけの `@page` で残りを `pdfMargin` に委ねる合成はしない。
- **抽出はテキスト走査**: CSS コメント内の `@page` や、`<style>` 内の文字列リテラルに
  現れる `@page` も拾いうる (実用上問題なし)。`@page` の入れ子ブロックは想定しない。
- **配列入力経路 (`htmls` 2 件以上) は対象外** (従来どおり 1 要素 = 1 頁、`@page` 無視)。

## スコープ外 (P5 対象外 / YAGNI)

- 名前付き頁 (`page: foo`)、`:left` / `:right` / `:first` 擬似頁。
- ノンブル制御 (`counter-reset: page` / `counter(page)` / `counter(pages)`)。
- 縦書きの頁進行方向。
- 頁単位の再レイアウト最適化 (P1 からの「頁数分 draw + canvas clip」のまま)。
- `@page` の他プロパティ (border / padding / marks / bleed / size の `auto` 合成)。

---

# PDF footer 帯の自動確保 (P6)

`pdfFooter` 指定時に footer が頁外/クリップされる問題を修正した。対象は
`src/cpp/renderers/pdf_renderer.cpp` のみ (レイアウト本体は不変)。

## 背景

footer は常に `pdfMarginBottom` の帯の中へ描画されていた (`y = pageHeight - marginBottom`)。

- `pdfMarginBottom = 0` (既定): `y = pageHeight` となり頁外で不可視。
- footer 高 > `pdfMarginBottom`: 帯の下側がクリップされる。

## 実装

- `measure_template_height()` を追加: footer テンプレートを幅 `contentWidth` で 1 回レイアウトし、
  `document::height()` を帯高の測定値とする (probe viewport = `max(pdfMarginBottom, 1)`)。
- 帯高 `footerBand = max(pdfMarginBottom, 測定した footer 高)`。
- footer は `y = pageHeight - footerBand`、高さ `footerBand` で描画する。
- **測定値が `pdfMarginBottom` を超える場合だけ**帯を拡張する:
  - 単一 HTML 経路 (`renderHtmlToPdf`): `contentAreaHeight` を増分だけ縮小し、頁数・頁ボックスは維持。
  - 配列入力経路 (`renderHtmlsToPdf`): 頁ボックス高を増分だけ拡張し、本文位置は不変。

## 互換性 (重要)

- footer 高が `pdfMarginBottom` 以下 (例: bottom=40 に 1 行 footer) の文書は**従来と完全に同じ**
  配置・頁数。既存の `pdf:verify` の header/footer ケース (bottom=40) も不変。
- footer 高が `pdfMarginBottom` を超える文書 (既定 bottom=0 を含む) は本文領域が
  `footer高 - pdfMarginBottom` だけ減るため、**頁数が増えることがある**。
  これは頁外 footer を可視化するための意図的な挙動変更。
- 既存 API の追加・変更は無し (opt-in フラグも不要)。

## 検証

- `nomargin` (bottom=0, 単一 HTML): footer テキスト `FOOT` が 3 頁すべてに出現。
- `margin40` (bottom=40, 単一 HTML): `FOOT` が 3 頁すべてに出現、頁数は従来どおり 3。
- 配列入力 (bottom=0, 2 頁): 各頁に `FOOT` が出現し、頁数 2 のまま。
- `pnpm --filter visual-test pdf:verify`: `ALL OK`。
- `pnpm test:visual`: 344 passed / 8 skipped。

