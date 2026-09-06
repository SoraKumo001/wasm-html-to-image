---
sidebar_position: 2
title: render() & オプション
---

# render() & オプション詳細

`render()` は、HTML または画像を目的のフォーマットへ変換・描画する統一関数です。

## シグネチャ

```typescript
// wasm-html-to-image/single
export function render(
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;

// wasm-html-to-image
export function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
```

:::note 戻り値の型
フォーマットが `svg` の場合は `string`（SVG マークアップ文字列）、それ以外のすべての形式（`png`, `jpeg`, `webp`, `avif`, `pdf`, `raw`, `thumbhash`）では `Uint8Array` を返します。
:::

---

## オプション一覧 (`HtmlToImageOptions`)

### 基本オプション

| オプション | 型                                                |  既定値  | 説明                                                                       |
| ---------- | ------------------------------------------------- | :------: | -------------------------------------------------------------------------- |
| `value`    | `string \| string[] \| Uint8Array \| ArrayBuffer` |    -     | 入力データ。HTML 文字列、複数ページ PDF 用 HTML 配列、または画像バイナリ   |
| `url`      | `string`                                          |    -     | 取得して描画する Web ページの URL（`value` が未指定の場合に使用）          |
| `baseUrl`  | `string`                                          |    -     | 相対パスのリソース解決に使用するベース URL                                 |
| `width`    | `number`                                          | **必須** | ビューポート幅（HTML 時）、または出力幅（画像リサイズ時）                  |
| `height`   | `number`                                          |  `auto`  | ビューポート高さ（HTML 時）、または出力高さ（画像リサイズ時）              |
| `format`   | `OutputFormat`                                    | `"png"`  | 出力形式 (`png`, `jpeg`, `webp`, `avif`, `raw`, `thumbhash`, `svg`, `pdf`) |

### エンコード & リサイズ

| オプション  | 型                                                        | 既定値  | 説明                                                                         |
| ----------- | --------------------------------------------------------- | :-----: | ---------------------------------------------------------------------------- |
| `quality`   | `number`                                                  |  `85`   | 圧縮品質 (0〜100)。JPEG, WebP, AVIF のエンコード時に適用（SVG/PDF では無視） |
| `speed`     | `number`                                                  |   `6`   | エンコード速度 (0〜10)。主に AVIF エンコード時に有効                         |
| `fit`       | `"contain" \| "cover" \| "fill"`                          |    -    | リサイズ戦略                                                                 |
| `crop`      | `{ x: number, y: number, width: number, height: number }` |    -    | 切り抜き矩形                                                                 |
| `animation` | `boolean`                                                 | `false` | アニメーションフレームを保持するか（対応形式のみ）                           |

### フォント & スタイル

| オプション      | 型                                        |       既定値       | 説明                                                                  |
| --------------- | ----------------------------------------- | :----------------: | --------------------------------------------------------------------- |
| `fontMap`       | `Record<string, string>`                  | `DEFAULT_FONT_MAP` | 汎用フォント名 (`sans-serif` 等) から Google Fonts URL へのマッピング |
| `fallbackFonts` | `(Uint8Array \| ArrayBuffer \| string)[]` |        `[]`        | ユーザー注入のフォールバックフォント（バイト列、Data URL、取得URL）   |
| `fonts`         | `{ name: string, data: Uint8Array }[]`    |        `[]`        | 事前ロードする名前付きフォント                                        |
| `css`           | `string`                                  |         -          | 追加で挿入するカスタム CSS 文字列                                     |
| `mediaType`     | `"screen" \| "print"`                     |     `"screen"`     | CSS の `@media` ルール評価対象                                        |
| `textToPaths`   | `boolean`                                 |       `true`       | SVG 出力時にテキストをパス（アウトライン）へ変換するか                |

### 高度な制御 & 診断

| オプション        | 型                                             | 説明                                                               |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `resolveResource` | `(url: string) => Promise<Uint8Array \| null>` | リソース（フォントや画像）取得のカスタムインターセプトフック       |
| `logLevel`        | `LogLevel`                                     | ログ出力レベル (`None`, `Error`, `Warn`, `Info`, `Debug`, `Trace`) |
| `onLog`           | `(level: LogLevel, message: string) => void`   | ログ受信用コールバック                                             |
| `diagnostics`     | `boolean`                                      | 詳細な診断レポートを収集するか                                     |
| `onDiagnostics`   | `(report: RenderDiagnostics) => void`          | 診断レポート受信用コールバック                                     |
| `limits`          | `RenderLimits`                                 | 最大リソース数、最大メモリサイズなどの安全上限                     |

### PDF メタデータ

| オプション    | 型       | 説明                       |
| ------------- | -------- | -------------------------- |
| `pdfTitle`    | `string` | PDF ドキュメントのタイトル |
| `pdfAuthor`   | `string` | 作成者                     |
| `pdfSubject`  | `string` | サブジェクト / 件名        |
| `pdfKeywords` | `string` | キーワード                 |
| `pdfCreator`  | `string` | 生成アプリケーション名     |
