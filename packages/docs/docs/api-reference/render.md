---
sidebar_position: 2
title: render() & オプション
---

# render() & オプション詳細

`render()` は、HTML または画像を目的のフォーマットへ変換・描画する統一関数です。

## シグネチャ

```typescript
// wasm-html-to-image (標準), /single, /workers, /workerd, /edge-light
export function render(
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export function render(
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;

// wasm-html-to-image/index (低レイヤ明示的モジュール版)
export function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;
```

## 戻り値 (`RenderResult<T>`)

`render()` および `htmlToImage()` は、生成された画像データと画像メタデータ（寸法・フォーマット等）を格納した `RenderResult` オブジェクトを返します。

```typescript
export interface RenderResult<T = Uint8Array | string> {
  /** 出力バイナリデータ (Uint8Array)、またはSVGマークアップ文字列 (string) */
  data: T;
  /** 出力画像の幅（ピクセル単位） */
  width?: number;
  /** 出力画像の高さ（ピクセル単位） */
  height?: number;
  /** 変換前の元画像の幅（画像入力時） */
  originalWidth?: number;
  /** 変換前の元画像の高さ（画像入力時） */
  originalHeight?: number;
  /** 出力フォーマット */
  format?: ImageFormat;
  /** アニメーション画像であるか */
  isAnimated?: boolean;
}
```

:::note 戻り値の型
出力データ本体は `result.data` に格納されます。フォーマットが `svg` の場合は `string`（SVG マークアップ文字列）、それ以外のすべての形式（`png`, `jpeg`, `webp`, `avif`, `jxl`, `pdf`, `raw`, `thumbhash`）では `Uint8Array` となります。
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
| `format`   | `OutputFormat`                                    | `"png"`  | 出力形式 (`png`, `jpeg`, `webp`, `apng`, `gif`, `tiff`, `avif`, `jxl`, `raw`, `thumbhash`, `svg`, `pdf`) |
| `colorSpace` | `"srgb" \| "cmyk"` | `"srgb"` | `tiff` と `pdf` の出力色空間。`"cmyk"` は印刷用で、TIFF は透明部分を白に合成した CMYK（Separated）画像、PDF はすべての塗り・線・画像を DeviceCMYK に書き換えます。変換は単純なデバイス式（K = 1 − max(R,G,B)、黒は K のみ）で ICC プロファイルは適用しないため、鮮やかな画面色は色域マッピングされません。他の形式では無視されます |

### エンコード & リサイズ

| オプション  | 型                                                        | 既定値  | 説明                                                                         |
| ----------- | --------------------------------------------------------- | :-----: | ---------------------------------------------------------------------------- |
| `quality`   | `number`                                                  |  `85`   | 圧縮品質 (0〜100)。JPEG, WebP, AVIF のエンコード時に適用（SVG/PDF では無視） |
| `speed`     | `number`                                                  | AVIF: `8` / その他: `6` | エンコード速度 (0〜10)。AVIF・JXL・アニメーション WebP（非可逆）で有効。アニメーション WebP は libwebp の method を `8 - speed` で決め、既定の 6 は method 2、5 は method 3（約 4% 小さい）、9 は method 0（最速、約 30% 大きい）。AVIF は 6 より数倍速く、ファイルは約 15〜20% 大きくなります。最小サイズが必要なら `speed: 6` を指定してください |
| `fit`       | `"contain" \| "cover" \| "fill"`                          |    -    | リサイズ戦略                                                                 |
| `crop`      | `{ x: number, y: number, width: number, height: number }` |    -    | 切り抜き矩形                                                                 |
| `animation` | `boolean \| { duration: number; fps?: number; loop?: number }` | `false` | アニメーションフレームを保持するか（対応形式のみ）。HTML 入力では `{ duration, fps, loop }` で `@keyframes` をサンプリング。`webp` / `apng` / `gif` で出力できます。`loop` は再生回数（`0` = 無限 = 既定、`1` = 1 回だけ）。文書内のすべての `@keyframes` が、ルールのセレクタに一致する全要素を動かします（1 要素の複数アニメーションは重ねて適用）。ループ長は CSS の `animation-duration` が優先され、`duration` はその上限クランプ、`fps` は上限のフレームレート |

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

### 信頼できない HTML を描画するとき (`limits`)

ユーザー入力の HTML を描画する場合は、`limits` で取得先と量を必ず絞ってください。既定ではどのホストにも fetch し、Node では `baseUrl` 配下のローカルファイルも読み込みます。

| `limits` のキー         | 型         | 説明                                                                                                             |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`             | `number`   | 描画全体のタイムアウト。個々の fetch も残り時間で中断されます                                                    |
| `maxResourceCount`      | `number`   | 取得するリソース数の上限                                                                                         |
| `maxResourceBytes`      | `number`   | 1 リソースあたりの最大バイト数                                                                                   |
| `maxTotalResourceBytes` | `number`   | 全リソースの合計バイト数の上限                                                                                   |
| `allowedProtocols`      | `string[]` | 許可するプロトコル (例: `["https:"]`)                                                                            |
| `allowedHosts`          | `string[]` | 許可するホスト名                                                                                                 |
| `blockedHosts`          | `string[]` | 拒否するホスト名                                                                                                 |
| `confineFilesToBaseUrl` | `boolean`  | **オプトイン (Node のみ)**。ローカルファイルの読み込みを `baseUrl` 配下（シンボリックリンク解決後）に限定します。`../` での脱出は拒否され、`baseUrl` がない場合はローカルファイルを一切読みません |

```ts
await render({
  value: untrustedHtml,
  width: 1200,
  baseUrl: "/srv/assets",
  limits: {
    timeoutMs: 10_000,
    maxResourceCount: 20,
    maxTotalResourceBytes: 10_000_000,
    allowedProtocols: ["https:"],
    confineFilesToBaseUrl: true,
  },
});
```

取得したリソースはプロセス内にキャッシュされます（最大 256 件 / 64 MiB、古いものから破棄、リモート取得は User-Agent ごと）。元のファイルを差し替えた場合は `clearResourceCache()` で破棄できます。

### PDF メタデータ

| オプション    | 型       | 説明                       |
| ------------- | -------- | -------------------------- |
| `pdfTitle`    | `string` | PDF ドキュメントのタイトル |
| `pdfAuthor`   | `string` | 作成者                     |
| `pdfSubject`  | `string` | サブジェクト / 件名        |
| `pdfKeywords` | `string` | キーワード                 |
| `pdfCreator`  | `string` | 生成アプリケーション名     |
