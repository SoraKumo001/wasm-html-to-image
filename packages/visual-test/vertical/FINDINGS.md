# 縦書き (writing-mode) 検証結果

Chromium (Playwright 同梱系 1248) を基準に、81 ケースを wasm エンジンの PNG と並置比較した結果。
ケースは `gen-cases.ts` が `cases/*.html` を生成し、`compare.ts` が `out/<case>.png`
(左: Chromium / 右: 本エンジン) を出力する。

```bash
cd packages/visual-test
npx tsx vertical/gen-cases.ts                 # ケース生成
npx tsx vertical/compare.ts [部分一致]         # Chromium 比較 (メトリクス + 並置画像)
npx tsx vertical/formats.ts [部分一致...]      # PNG / SVG / PDF の整合性
```

`CHROMIUM_PATH` で Chromium 実行ファイルを差し替え可能 (既定は ms-playwright の 1248)。
フォントは両者とも同じ Noto Sans JP の woff2 を `@font-face` で読み込む。

## 問題なし (目視確認済み)

vertical-rl / vertical-lr の基本、列の折り返し、句読点・括弧・長音の回転/配置、
ラテン文字の横倒し、`text-orientation` (mixed/upright/sideways)、`text-combine-upright` (4 桁・英字)、
box model (margin/padding/border の論理方向)、固定サイズ + overflow、`<br>`/`pre`/`nowrap`、
`overflow-wrap:anywhere`、超長英単語、インライン背景/太字/斜体/サイズ混在、
`text-decoration` (underline/overline/line-through/wavy/dotted 単体)、画像のインライン配置、
flex (row / column / center)、縦横混在の入れ子 (縦⇔横、RL⇔LR)、`position:absolute`、
背景グラデ・角丸・影、`transform: rotate`、半透明 + clip、`-webkit-text-stroke`/`text-shadow`、
`background-clip:text`、`text-overflow:ellipsis`、`::before/::after`、絵文字・記号、
`body`/`html` 自体の縦書き、見出し/段落/blockquote、フォント混在。
SVG 出力は PNG と一致 (差分 < 1%)、PDF 出力も縦書きのまま 1 ページに出力される。

## 修正済み (本変更)

| # | 内容 | 結果 |
|---|------|------|
| 1 | table の縦書きレイアウト (`layout_table_vertical`、罫線軸の転置) | 22/74: 高さ 912→456px で Chromium と一致 |
| 2 | grid の縦書き (列=インライン軸/行=ブロック軸へ転置) | 63: 差分 36%→3% |
| - | `display:inline-grid` のインライン整形対応 (行への組込み、shrink-to-fit 幅決定、先行ベースライン配置) | H/V プローブで Chromium と一致。明示 auto/fr・複数自動列・last=first は残件 |
| - | columns (`column-count`/`column-width`/`columns`/`column-gap`/`column-rule`): width→fr 換算、gap normal→1em、rule 描画。均等バランス・断片化・`column-span` は対象外 | 横書きプローブ p1/p3/p5/p6/p7 で 0.0%/0.0% 一致 |
| 3 | inline-block: 縦書きでの shrink-to-fit 判定、中央ベースライン | 18/86/87: 4〜5%→0〜2% |
| 4 | float: 縦書き行ボックスが float を避ける、rl での fmt_ctx オフセット補正 | 77: 5.3%→2.7%、30 も回り込み (高さ差 54px は未解決) |
| 6 | text-indent (副次的に修正) | 13/56/44: outline 17%→2.6% |
| 5 | リストマーカー (ul/ol を各列の先頭へ) | 20: 箇条書き・番号が Chromium と同じ位置 |
| 9 | justify が最終行を均等割付しない | 12/80 |
| 10 | `inline-size` / `block-size` / min・max 版を書字方向に応じて物理サイズへ対応付け (横書きも) | 40: outline 6.9%→1.1% |
| - | 横書き table 内の縦書きセル: 列幅に block size を使う | 22/75: セル幅が Chromium と同等 (75 の長文セルは高さ制約での折返し未対応) |
| 11 | `vertical-align: super/sub` (フォントメトリクスの super_shift/sub_shift が未設定だった。横書きも同様) | 39/63a |
| 12 | 列をまたぐインラインの枠線・角丸 (縦書きでは左右の辺を各断片に、上下の辺を先頭・末尾にだけ描く) | 67: 辺の描画は一致。断片のサイズ・折返し位置には差が残る |
| 14 | `writing-mode: sideways-rl` (vertical-rl + `text-orientation: sideways` へ折り畳み) | 66: sideways-rl は一致 |
| - | `writing-mode: sideways-lr` のインライン軸反転 (`sideways-lr` は下→上に読む。折り畳み前に `is_inline_reverse` を `css_properties` に保持し、`line_box` の第2パス直前で縦書きのインライン座標 y のみミラー。述語は `sideways-lr` のみ) | 66: outline 1.7%→1.4% (sideways-lr が Chromium と同順) |
| - | 縦書き `direction:rtl` で RTL の視覚順序反転 (物理X軸) が誤発火していたのを横書きに限定 | 65: outline 2.5%→2.1% |
| - | 縦書き `direction:rtl` の短行をインライン終端 (=下端) へ寄せる (`line_box::finish` のミラー直後・第2パス前に vertical + rtl + 非 reverse + 短行のとき全 lbi の y に空きを加算。現在位置基準の再計算で再 finish は no-op。第一パス・start/end マップ・論理ジオメトリ・can_hold/add_item/new_inline_size 不変、sideways-lr 除外、center/justify 対象外) | 65: outline 2.1%→1.7%、高さ一致 (800x266)。66 不変 |
| 5 | リストマーカー `cjk-ideographic` / `hiragana` / `hiragana-iroha` / `katakana` / `katakana-iroha` (末尾は 、)。マーカー文字をレイアウト時に計測してグリフ収集へ登録 | 20/64a |
| 1 | 縦書き table の caption (`caption-side: top` はブロック開始側、`bottom` は終端側) | 74a/74b |
| 13 | `html` 直接指定の縦書き: 縦書きで高さが確定した要素の子に shrink-to-fit を引き継がない | 61: outline 4.0%→1.1%、61i: 72.8%→0.2% |
| - | table セルの `vertical-align` を縦書きではブロック軸 (横方向) に適用 (従来は物理的な縦方向にずれていた) | 75: outline 1.9%→0.6% |
| - | `<ruby>` / `<rt>` (UA スタイルで inline-flex + column-reverse。縦書き・横書き両対応) | 07/79/79a: ルビが基底文字の上(縦書きは右)に出る |
| - | 縦書きの `<ruby>` を不可分なインラインとして扱う (アノテーションが基底文字を 2 列に割らない。UA 規則に `text-indent:0` を追加し、コンテンツ幅で計測・配置。収まらない場合は次の列へ丸ごと移動) | 44: ルビが 1 列に収まり、`fill 3.6%→3.5% / outline 5.1%→4.0%` |
| - | `render_item::measure` のキャッシュヒット時の戻り値を縦書きではインライン方向の長さに修正 | |
| 13 | `body` の縦書きをルートへ伝播し、右端基準で配置 | 60: outline 11.5%→2.1% |
| 8 | `text-combine-upright:all` (結合ランを横書きで再整形して 1em に圧縮) | 06/94: Chromium と同等 |
| 7 | `letter-spacing` (横書き・縦書きとも。font description 生成前に解決、グリフ間隔を加算) | 99/16。`word-spacing` は未検証 |
| 14 | `text-emphasis` (圏点): `text_renderer.cpp` に per-glyph 描画を追加。filled/open × dot/circle(円近似)/triangle/sesame(短い太線)、over/under・right/left 配置、空白・結合マーク除外、currentColor 解決。tagging(SVG)/stroke上塗り/tcyランは対象外 | 14: 中央列にゴマ点が Chromium と同位置に付く (fill 2.6% 変化なし=他列の既存差分が支配、outline 4.1%→3.9%) |
| - | `::first-letter` の付与対象を `::before` 子テキスト優先に修正 (空 before は skip、`::after` は対象外。decode_utf8 分割・wrapper・二重分割ガード維持) | 62: 【が緑 2em で Chromium と一致 (fill 1.0% / outline 1.7%)。「前」までの拡大は未対応 |
| - | 縦書きブロックを BFC 化 (float の高さ漏れ) | 30/77: ページ高さ 320→266px で一致 |
| - | 縦書きの下線・上線の位置 (下線はブロック開始側の内側、上線はブロック終端側の内側へ) | 43: fill 0.7%→0.3% / outline 0.8%→0.5% |
| - | `position:fixed` を文書高さ算出から除外 (fixed サブツリー全体を `calc_document_size` でスキップ。viewport 基準の子座標が混入し高さが膨らんでいた) | 短文+fixed bottom-right 2979→55px、長文 2979→2366px に復帰 |
| - | `display:inline-grid` のインライン整形 (行への組込み・shrink-to-fit・先行ベースライン。縦書き含む) | H/V 最小プローブで幅・高さ一致 (残差はフォントのラスタ差のみ。h-fixed 4.5%/4.2%、h-auto 2.0%/1.9%、h-base 2.5%/3.7%、v-fixed/v-auto 0.4%/0.3%) |

既存の横書きビジュアルテスト 26 アセットは基準値から ±0.3% 以内で回帰なし。
- 横書き先頭 float の measure 台帳汚染 (76: `place_float` が measure 時に未配置座標で `add_float` し、共有 fmt_ctx に残った phantom が place 時の行幅計算を狂わせていた。measure + 横書き時のみ台帳更新を skip し自幅を返す。縦書きは従来通り): 76 fill 6.9%→3.2% / outline 9.9%→2.2%、高さ 201→154px で Chromium と一致。vertical 全数・vitest 155 件・横書き 26 件で回帰なし (76 の baseline のみ正値へ更新)。
未対応・既知の制限:
- inline-grid: 固定トラック + 暗黙の自動単一列のみ対応。明示 `auto` トラック・`fr` の shrink、複数自動列の内容按分は未対応 (固定列は可用幅で解決される)。ベースラインは先行 (first row) のみ (last も同一値を返す)。
- ルビ: 1 つの `<ruby>` に複数の `<rt>` を持つ複合ルビ、`rtc`、ルビの均等割付は未対応。縦書きで折り返し位置にルビが来る場合の 2 列分割は修正済み (44)
- 縦書き内の `direction:rtl` (65): Chromium は LTR ラン (CJK・ラテン) の字順を反転せず、行をインライン終端 (=下端) へ寄せる。字順反転の誤発火修正に加え、短行の下端寄せ配置に対応 (残留 outline 1.7%。text-align:center/justify は対象外)。Chromium 実測: `vertical-rl/lr` + `direction:rtl` では各字は上→下のままで、短い行だけ下端に寄る (字順は不変)。
- カラー絵文字 (64): font-family に絵文字フォントが無くても、どの書体にも無い絵文字があれば fontMap の Noto Color Emoji を自動取得して描画する (横書き・縦書き)。U+2600–27BF の ★☆ 等は通常書体で黒く描く (従来は白塗りで消えていた)。

## 不具合 (縦書き以外でも起きるもの / 参考)

- ~~`text-emphasis` (圏点) 未対応 (14)~~ → 本変更で対応 (上記)。残件: カスタム文字列、SVG(tagging)出力、tcyラン、`open` 以外の装飾組み合わせの厳密比較。
- ~~`::first-letter` 未対応 (62)~~ → 本変更で対応 (上記)。残件: Chromium は「前」まで 2em 緑化するが本実装は先頭 1 文字 (【) のみ適用 (約物スキップ等の厳密一致は未対応)。
- 横書きの先頭 float 右寄せでテキストが下へずれていた (76) → 本変更で修正 (下記)。残差 fill 3.2% / outline 2.2% は約物詰め (`text-spacing-trim`) 相当が無いための行末・折返し位置差 (03, 17 と同種の仕様差)。
- Chromium の `text-spacing-trim` (約物の詰め) 相当が無く、行末位置・折返し位置が微妙にずれる (03, 17)。バグではなく仕様差。

## 未検証

目視していないケース (メトリクス上は差分 < 3%): 05, 10, 11, 24, 25, 32, 35–38, 41, 42, 64, 68–73。
複数ページ PDF の改ページ、`columns` は未実施。フォント fallback の CJK 外字は下記「CJK 外字 fallback (Ext-A 以降/IVS)」で対応済み。

## CJK 外字 fallback (Ext-A 以降/IVS)

Google Fonts の Noto subset (`unicode-range`) は Ext-A (U+3400〜)・Ext-B 以降・IVS (U+E0100〜)・
BMP の稀用字 (U+9FFF 等) を含まない。`getFontUrls` の usedCodepoints 駆動取得だけでは該当 subset が
存在せず tofu になる (Chromium はシステムフォントで描画するため差が出る)。
最小プローブ (`packages/visual-test/temp/cjk-ext-probe.*`、Ext-A U+3400 + Ext-B U+20000/U+2A6D6 +
IVS 葛+U+E0100 + 絵文字混じり) で事前確認: Ext-A/B・U+9FFF が本エンジンのみ tofu。

対応 (取得のみ。選択・描画は既存の per-glyph `selectFont` + global fallback をそのまま使う):

- `SatoruFontManager::uncoveredCodepoints` (font_manager.h/cpp) を追加。読み込み済み書体の
  いずれにもグリフが無く、どの `@font-face` の `unicode-range` にも該当しない codepoint を返す。
  `unicode-range` 無しの `@font-face` (fontsource 丸ごと等) は family 未読み込みの間のみ請求中とみなす
  (読み込み後にグリフが無ければ未対応として返す)。HanaMin.css 自体は未取得ブロックの索引なので
  被覆根拠から除外する (さもないと取得が発生しない)。
- `collect_resources` (satoru_api.cpp) で上記 missing (絵文字は除外) に対し、HanaMin.css
  (`https://cdn.jsdelivr.net/npm/hanamin@0.0.5/HanaMin.css`) を Css として取得→走査し、
  翌ラウンドで `getFontUrls("hanamin", ...)` の該当ブロック woff2 のみを `__fallback__` 名で取得する。
  相対 URL は同ベースで絶対化する。通常ドキュメント (missing 無し) では追加リクエストは発生しない。
- `resource_manager.cpp` で `__fallback__` 名の読み込み書体を global fallback へ登録
  (重複排除あり)。`selectFont` が Ext グリフを拾う。診断用に `cppExtMissingCount` /
  `cppHanaUrlCount` を collect profile に追加。

結果 (プローブ再実行、左 Chromium / 右 本エンジン):

- Ext-A U+3400、Ext-B U+20000/U+2A6D6 が描画されるようになった (HanaMin=明朝体のため
  Chromium のゴシックとは書体が異なる。存在修正であり字形一致は対象外)。
- IVS は基字 (葛) が描画され、セレクタ自体は従来通り無視 (変化なし)。
- 残件: BMP 稀用字 U+9FFF は Noto subset・HanaMin のどちらにも存在せず tofu のまま
  (Chromium はシステムフォントで描画)。カラー絵文字は従来通り未対応 (別経路のため対象外)。

検証: wasm build + package build 済み。vitest 155 件 (visual-test) + unit 135 件が通過。
vertical `compare.ts` 全数 (108 ケース) はエラー無し・メトリクスは既存 baseline 圏内
(例: 76 fill 3.2% / outline 2.2% で一致)。横書き 26 アセット (png+svg vitest) も通過。
SVG (text-to-paths)・PDF も同プローブで出力確認 (Ext-A/B はパス化される)。
