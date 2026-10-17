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
| 3 | inline-block: 縦書きでの shrink-to-fit 判定、中央ベースライン | 18/86/87: 4〜5%→0〜2% |
| 4 | float: 縦書き行ボックスが float を避ける、rl での fmt_ctx オフセット補正 | 77: 5.3%→2.7%、30 も回り込み (高さ差 54px は未解決) |
| 6 | text-indent (副次的に修正) | 13/56/44: outline 17%→2.6% |

既存の横書きビジュアルテスト 26 アセットは基準値から ±0.3% 以内で回帰なし。
未対応: 縦書き table の caption、table セルの縦横混在 (75)、float の最終高さ差 (30/77)。

## 不具合 (縦書き固有) — 修正前の一覧

| # | 症状 | ケース |
|---|------|--------|
| 1 | **table**: 縦書き `table` が破綻 (高さが 4 倍近く膨らみ、セル配置が崩れ次の要素と重なる) | 22, 74 |
| 2 | **grid**: 縦書き grid コンテナで文字が横方向に潰れて重なる (ほぼ描画不能) | 63 |
| 3 | **inline-block + テキスト**: 行内に他テキストと並ぶ inline-block で、親ボックスが空になり内容が右へずれて描画される。内容なし inline-block の位置もベースラインがずれる | 18, 87, 86 |
| 4 | **float**: 縦書きで float に文章が回り込まない (重なる) | 30, 77 |
| 5 | **リストマーカー**: マーカーが 1 つだけ下端に出て本文と重なる / `ol` は 3. のみ / `cjk-ideographic` は無表示 | 20 |
| 6 | **text-indent** が無視される | 13, 56, 44 |
| 7 | **letter-spacing / word-spacing** が無視される | 16, 58 |
| 8 | **text-combine-upright:all** が 2 桁数字で結合されず「2 1」と縦に並ぶ | 06 |
| 9 | **text-align:justify** が最終行まで均等割付される | 12, 80 |
| 10 | `block-size` 指定が反映されない (内容に合わせて広がる) | 40 |
| 11 | `vertical-align: super/sub` の位置ずらしが効かない | 39 |
| 12 | 分割されたインライン (列またぎ) の枠線・背景の描画が不正確 | 67 |
| 13 | ルート要素を縦書きにした際、ブロック起点が右端から約 20px ずれる | 60 |
| 14 | `direction:rtl` (縦書き内)、`writing-mode: sideways-rl/lr` 未対応 | 65, 66 |

## 不具合 (縦書き以外でも起きるもの / 参考)

- `<ruby>` が未対応 (ルビがインライン展開される) — 横書きでも同様 (07, 79)。
- `text-emphasis` (圏点) 未対応 (14)。
- `::first-letter` 未対応 (62)。
- 横書きでも先頭 float 右寄せ時にテキストが下へずれる (76)。
- Chromium の `text-spacing-trim` (約物の詰め) 相当が無く、行末位置・折返し位置が微妙にずれる (03, 17)。バグではなく仕様差。

## 未検証

目視していないケース (メトリクス上は差分 < 3%): 05, 10, 11, 24, 25, 32, 35–38, 41–43, 64, 68–73。
複数ページ PDF の改ページ、`display:inline-grid`/`columns`、フォント fallback の CJK 外字は未実施。
