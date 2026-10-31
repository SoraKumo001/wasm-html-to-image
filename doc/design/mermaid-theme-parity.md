# Mermaid テーマの色を公式に近づける — 計画

状態: 計画(方針決定済み・未着手)。比較環境: `C:\prog\samples\wasm-html-to-image-samples\mermaid-compare`。
対象: `src/cpp/mermaid/mermaid.cpp`(`kPresets`)、`mermaid_internal.h`(`Theme` / `make_theme`)、各図種の `.cpp`。

## 現状の確認

エンジンのテーマは `kPresets` の 6 色(fg, bg, border, surface, accent, line)だけで、残りは `make_theme` が
`color-mix(fg, bg, N%)` で導く。つまり色は「前景と背景の混色」であり、公式のように
primary / secondary / tertiary を別々に持たない。公式との乖離の根はここにある。

| 項目 | 公式 (default) | エンジン (light) |
|---|---|---|
| ノードの塗り | `#ECECFF`(薄紫) | `surface` = fg と bg の 3% 混色(ほぼ白) |
| ノードの枠 | `#9370DB` | `border` = 20% 混色(灰) |
| 線・矢印 | `#333333` | `line` = 50% 混色 |
| クラスタ / ノート | `#ffffde` / `#fff5ad` | `group_hdr` など混色 |
| 円グラフなどの系列色 | 12 色のスケール | `accent` からの派生 |

(公式の値は記憶による。段階 1 で実測して置き換える。)

比較アプリ側にも問題がある。`renderOfficial.ts` は `nord` `dracula` `solarized-*` `rose-pine` `sepia` を
公式の `dark` / `neutral` / `default` に丸めている。公式にこれらのテーマはないので、乖離の一部は
比較側の対応づけが原因で、エンジンを直しても縮まらない。

## 方針

1. 対象は公式にあるテーマだけ。`light`(= `default` / `base`)`dark` `forest` `neutral` を公式の実測値に合わせる。
   - 決定: `light` も公式 `default` と同じ色にする。エイリアスは今のまま(`default` / `base` → `light`)で、
     `light` の色が変わる。GitHub 風の配色は残さない。
   - 決定: 独自 6 種(`nord` `dracula` `solarized-*` `rose-pine` `sepia`)は現状維持。色の値も導出も変えない。
     図種側の色の参照は新しい項目へ置き換えるので、追加項目が空のときは従来の導出になるようにし、
     独自テーマの出力が変わらないことをテストで固定する。
2. エンジンの `Theme` に、導出ではなく明示で持てる色を足す。空なら今までどおり混色で導く。
   既存の `Options`(利用者が `fg` / `bg` だけ渡す使い方)は変わらない。

## 段階

### 1. 測る(比較環境側)

- `renderOfficial.ts` は、公式にあるテーマ(`light`→`default`、`dark`、`forest`、`neutral`)の対応だけを正す。
  独自 6 種は比較の対象外にし、アプリ上でも対象外と分かる表示にする。
- 公式の値を `mermaid.mermaidAPI.getConfig().themeVariables` から取り出して JSON に保存する
  (`primaryColor` `primaryBorderColor` `lineColor` `secondaryColor` `tertiaryColor` `noteBkg` `clusterBkg`
  `cScale0..11` など)。記憶ではなく実測を正とする。
- 色の差を数値で出すスクリプトを足す。両方の SVG から要素の種類(ノード / 枠 / 線 / 文字 / クラスタ /
  ノート / 系列)ごとに fill・stroke を集め、テーマ × 図種で ΔE(CIE76 で十分)の表を作る。
  これが以降の「近づいたか」の物差し。

### 2. エンジンの色の持ち方を拡張する

- `Preset` と `Theme` に追加(いずれも空なら導出): `primary`(ノードの塗り)、`primary_border`、
  `secondary`、`tertiary`、`note_bg` / `note_border`、`cluster_bg` / `cluster_border`、
  `text_on_primary`、系列色 `scale[12]`。
- `Options` に同じ項目を足すかは別に決める。既定は足さず、プリセットの内部だけで持つ。
- `make_theme` に公式の導出規則(primary から hue 回転で secondary / tertiary を作る、枠は primary を暗くする)を
  関数として入れ、明示がないプリセットでも公式に近い色になるようにする。

### 3. プリセットの値を合わせる

- `light` `dark` `forest` `neutral` に実測値を入れる。
- 独自 6 種は触らない。

### 4. 図種ごとの使い方を直す

色を参照している箇所は 23 ファイル・約 100 か所。共通部品に集約されている所(`classDef`、ノード描画)から順に、
`surface` / `border` / `accent` の直参照を新しい項目へ置き換える。

優先順(使用頻度と色の面積の大きい順):
1. フローチャート、状態遷移図、クラス図、ER 図(ノードの塗りと枠)
2. シーケンス図(アクター、ノート、アクティベーション、ループ枠)
3. 円グラフ、棒・折れ線グラフ、ガントチャート、ユーザージャーニー(系列色)
4. 残り(カンバン、Git グラフ、マインドマップ、サンキー図、ほか)

公式側で色が「テーマで決まらない」図種(マインドマップの枝の色など)は、一致させずに対象外と記録する。

### 5. 検証

- ホストテスト: テーマごとにフローチャートの SVG からノードの `fill` / `stroke` を取り出し、プリセットの期待値と
  照合するテストを足す。独自プリセットが導出で壊れないことも見る。
- コーパス 110 件はエラー枠が出ないことを見るだけなので、影響しない。再実行して 0 件を確認する。
- 比較スクリプトの ΔE の表を段階 1 と最後で比べ、図種ごとの改善を数字で出す。
- 影響する既存の試験: ビジュアルテストのうち Mermaid を含むピクセル基準と、PDF のテンプレート指紋
  (Mermaid を含む文書がある場合)。意図した変更として基準を取り直す。
- ドキュメント(`api-reference/mermaid.md` と英語版)のテーマ表を更新する。

## リスク

- 見た目が全体に変わる。`light` と、`theme` を指定しない既定の出力(既定は `light`)が変わる。変更履歴に明記する。
- 公式は図種ごとに色の決め方が違う(`cScale`、`git0..7` など)。一律の導出では合わない図種が残る。
- 公式のバージョンで値が動く(比較環境は mermaid 12.x)。実測 JSON にバージョンを記録する。
- 文字色の対比。公式の primary 上の文字色は暗い色で、`dark` 系のプリセットでは見え方が違う。

## 未決事項

- ΔE の合格ライン(提案: ノード・枠・線・文字は 5 以下、系列色は 10 以下)。

## 作業の見積もり

| 段階 | 内容 | 規模 |
|---|---|---|
| 1 | 比較側の修正と実測、差の表 | 小 |
| 2 | `Theme` / `Preset` / 導出関数 | 中 |
| 3 | プリセット値 | 小 |
| 4 | 図種ごとの置き換え(約 100 か所) | 大 |
| 5 | テスト、基準の取り直し、ドキュメント | 中 |
