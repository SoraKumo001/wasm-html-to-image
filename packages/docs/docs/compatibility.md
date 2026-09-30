---
sidebar_position: 3
title: 互換性と仕様
---

# 互換性と対応機能一覧

**wasm-html-to-image** がサポートする入力形式、出力フォーマット、CSS 仕様、および実行環境の対応状況です。

## 1. フォーマット対応マトリクス

### 入力形式 (`value`)

| 形式                | 判定方法                    | 説明                                                            |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| **HTML 文字列**     | 文字列 (先頭タグやテキスト) | 通常の HTML/CSS レンダリング                                    |
| **HTML 文字列配列** | `string[]`                  | 複数ページの PDF 出力専用                                       |
| **URL**             | `http://` または `https://` | 指定 URL の HTML を自動フェッチしてレンダリング                 |
| **画像バイナリ**    | `Uint8Array` / `Buffer`     | マジックバイトにより PNG, JPEG, WebP, GIF, AVIF, BMP を自動認識 |
| **Data URL**        | `data:image/*;base64,...`   | 画像として自動認識し最適化パイプラインへ直行                    |

### 出力形式 (`format`)

| フォーマット | 戻り値の型   | HTML 入力時の動作                          | 画像入力時の動作                  |
| ------------ | ------------ | ------------------------------------------ | --------------------------------- |
| `png`        | `Uint8Array` | Skia 描画 → PNG エンコード                 | 画像をデコードして PNG 出力       |
| `jpeg`       | `Uint8Array` | Skia 描画 → JPEG 圧縮 (`quality`)          | 画像をデコードして JPEG 圧縮      |
| `webp`       | `Uint8Array` | Skia 描画 → WebP 圧縮 (`quality`)          | 画像をデコードして WebP 圧縮      |
| `avif`       | `Uint8Array` | Skia 描画 → AVIF 圧縮 (`quality`, `speed`) | 画像をデコードして AVIF 圧縮      |
| `jxl`        | `Uint8Array` | Skia 描画 → JXL 圧縮 (`quality`, `speed`)  | 画像をデコードして JXL 圧縮（出力のみ。JXL 入力のデコードは未対応） |
| `raw`        | `Uint8Array` | RGBA 非圧縮ピクセルデータ                  | RGBA 非圧縮ピクセルデータ         |
| `thumbhash`  | `Uint8Array` | 描画結果から ThumbHash を生成              | 画像から ThumbHash を生成         |
| `svg`        | `string`     | Skia ベクター描画ストリーム                | `<image>` タグでラップした SVG    |
| `pdf`        | `Uint8Array` | SkPDFDocument によるベクター PDF           | 画像を等倍 1 ページに配置した PDF |

---

## 2. CSS & レイアウト対応状況

| 機能カテゴリー       | 対応機能                                                                | 詳細・特記事項                                         |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| **ボックスモデル**   | Margin, Padding, Border, Box-sizing, `aspect-ratio`                     | 論理プロパティ (`margin-inline` 等) も完全サポート     |
| **Flexbox**          | `flex`, `flex-direction`, `justify-content`, `align-items`, `flex-wrap`, `gap` | W3C 仕様準拠の多段レイアウト解決                       |
| **Grid**             | `grid-template-columns`, `grid-template-rows`, `grid-column`, `grid-row`, `gap`, `place-items` | 基本的なグリッド配置・トラック計算・自己配置をサポート |
| **位置指定**         | `position: static / relative / absolute / fixed`, `top`, `right`, `bottom`, `left`, `inset`, `z-index` | 包含ブロックに応じた正確な配置                         |
| **タイポグラフィ**   | HarfBuzz テキストシェイピング, BiDi (双方向テキスト), 縦書き (`writing-mode`) | CJK (日中韓)、アラビア語、絵文字、縦書き (`vertical-rl`)、文字縁取り (`-webkit-text-stroke`)、複数行省略 (`-webkit-line-clamp`) に対応 |
| **装飾・エフェクト** | `box-shadow`, `border-radius`, `opacity`, `transform`, `filter`, `backdrop-filter` | 角丸クリッピング、複数ドロップシャドウ、ブラー、色調整、トランスフォーム対応 |
| **グラデーション & 背景** | `linear-gradient`, `radial-gradient`, `conic-gradient`, `background-size`, `mix-blend-mode` | 複雑なカラーストップとアングル指定、ブレンドモードに対応 |
| **クリッピング & マスク** | `clip-path: circle(), ellipse(), polygon(), path(), inset()`, `mask` | Skia ネイティブパスによる自由形状クリッピングとアルファマスク |
| **インライン SVG**   | `<svg>`, `<path>`, `<circle>`, `<rect>`, `<g>`, `<linearGradient>` 等 | SkSVGDOM によるベクターグラフィックスの直接埋め込み描画 |
| **モダン CSS 機能**  | `calc()`, `light-dark()`, CSS 変数 (`var(--...)`), `@layer`             | 数値計算やデザイントークンの活用                       |
| **セレクタ**         | クラス, ID, 属性セレクタ, `:nth-child()`, `:not()`, `:is()`, `:where()`, `:has()`, `::before`, `::after` | 擬似クラス・擬似要素 (`content`) による高度なスタイリング |
| **レスポンシブ**     | `@container` (コンテナクエリ), `@media print`, `@media screen`          | コンポーネント単位のサイズ適応                         |

---

## 3. 非対応機能・制限事項 (AI コード生成時の注意点)

ブラウザエンジン（Chromium/WebKit）ではなく、軽量な **litehtml + Skia** の静的レンダラーであるため、以下の機能は動作しません。HTML/CSS を設計する際はこれらを避けてください：

1. **JavaScript の実行不可**: `<script>` タグやインラインイベントハンドラ (`onclick` など) は一切実行されません。静的な HTML/CSS マークアップのみ生成してください。
2. **CSS アニメーション / トランジション**: `@keyframes` や `transition` はアニメーションしません（静止画スナップショットとして描画されます）。
3. **HTML5 `<canvas>` スクリプト**: `canvas.getContext('2d')` による描画は行われません。図形描画にはインライン `<svg>` や CSS プロパティを使用してください。
4. **動的インタラクション**: `:hover`, `:active`, `:focus` などの動的疑似クラスは反映されません。
5. **ブラウザ専用 Web API**: `window`, `document`, `localStorage`, `IndexedDB` などの Web API は参照できません。

---

## 4. ランタイム互換性

| ランタイム              | サポート | 推奨サブパス                                                                          | 備考                                                                             |
| ----------------------- | :------: | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Node.js (>=20)**      |    ✅    | `wasm-html-to-image/single`<br/>`wasm-html-to-image`<br/>`wasm-html-to-image/workers` | シングルスレッド、インスタンス再利用、マルチスレッド Worker プールすべて利用可能 |
| **Cloudflare Workers**  |    ✅    | `wasm-html-to-image/workerd`                                                          | `.wasm` の import は現行 Wrangler でデフォルトでバンドルされるため追加設定不要（`rules` を自前定義するとデフォルト上書きになるため、カスタマイズ時・非常に古い Wrangler 利用時のみ必要） |
| **Vercel Edge Runtime** |    ✅    | `wasm-html-to-image/edge-light`                                                       | Edge 環境特有のメモリ制限・API 制約に最適化                                      |
| **モダンブラウザ**      |    ✅    | `wasm-html-to-image/single`<br/>`wasm-html-to-image/workers`                          | Web Worker を用いたバックグラウンド描画が可能                                    |
| **Deno**                |    ✅    | `wasm-html-to-image`                                                                  | Deno Deploy やローカル CLI で動作                                                |
| **Bun**                 |    ✅    | `wasm-html-to-image/single`                                                           | Node.js 互換レイヤー経由で高速動作                                               |
