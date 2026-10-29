---
sidebar_position: 4
title: 複数ページ PDF 帳票・レポート生成
---

# 複数ページ PDF 帳票・レポート生成

**wasm-html-to-image** は、HTML 文字列の配列 (`string[]`) を入力として受け取り、複数ページのベクター PDF ドキュメントを出力できます。

## 実装例

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";

// ページごとの HTML を定義
const page1 = `
  <div style="padding: 40px; font-family: 'Helvetica', sans-serif;">
    <h1 style="color: #2563eb;">売上レポート - 2026年9月</h1>
    <p>第 1 ページの内容です。</p>
  </div>
`;

const page2 = `
  <div style="padding: 40px; font-family: 'Helvetica', sans-serif;">
    <h2>詳細データ</h2>
    <table border="1" cellpadding="8" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f1f5f9;">
          <th>項目</th>
          <th>数値</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>成約件数</td><td>128 件</td></tr>
        <tr><td>売上総額</td><td>¥14,200,000</td></tr>
      </tbody>
    </table>
  </div>
`;

// 配列として渡すことで複数ページ PDF を生成
const { data: pdfBuffer } = await render({
  value: [page1, page2],
  width: 595, // A4 幅 (pt)
  height: 842, // A4 高さ (pt)
  format: "pdf",
  mediaType: "print",
  pdfTitle: "月次売上レポート",
  pdfAuthor: "営業企画部",
});

await fs.writeFile("monthly-report.pdf", Buffer.from(pdfBuffer));
```

## ヘッダー / フッター

`pdfHeader` / `pdfFooter` に HTML テンプレートを渡すと、各ページに再描画されます。
テンプレート内の `{{pageNumber}}` と `{{totalPages}}` はページ番号に置換されます。

```typescript
const { data: pdfBuffer } = await render({
  value: html,
  width: 595,
  format: "pdf",
  pdfFooter: `<div style="text-align:center">{{pageNumber}} / {{totalPages}}</div>`,
  pdfMargin: { top: 24, bottom: 32, left: 24, right: 24 },
});
```

footer は通常 `pdfMargin.bottom` の帯の中に描画されます。footer の実測高が
`pdfMargin.bottom` を超える場合（既定値 `0` を含む）は、帯を footer の高さまで自動で
広げ、その分だけ本文領域を縮めます。本文が収まるページ数が増えることがあります。
footer が margin に収まる場合は従来どおりの配置・ページ数です。

---

## Markdown からプロ品質の PDF レポートを生成

HTML を手書きする代わりに、`wasm-html-to-image/markdown` を使用して Markdown ドキュメントから自動で表紙・目次・ヘッダー・フッター・ブックマーク付きの PDF を作成できます。

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";
import { markdownToDocument } from "wasm-html-to-image/markdown";

const markdown = `---
title: プロジェクト進捗報告書
subtitle: 2026年第4四半期
author: 技術戦略室
date: 2026-10-29
template: report
accent: "#1e40af"
stamp: 社外秘
---

# 1. はじめに

本ドキュメントでは、今期のシステム移行プロジェクトの進捗と今後の計画について報告します。

# 2. 進捗状況

| マイルストーン | 予定期日 | 状況 |
| :--- | :--- | :--- |
| アーキテクチャ検証 | 2026/09/15 | 完了 |
| PoC 開発 | 2026/10/20 | 完了 |
| 本番環境移行 | 2026/11/30 | 進行中 |

# 3. 課題と対策

課題の詳細と対策案を以下に記載します。
`;

// markdownToDocument は PDF 生成に必要なヘッダー・フッター・タイトル情報も抽出します
const { html, renderOptions } = markdownToDocument(markdown, {
  paged: true, // ページ分割・余白最適化を有効化
});

const { data: pdfData } = await render({
  value: html,
  format: "pdf",
  ...renderOptions,
});

await fs.writeFile("progress-report.pdf", Buffer.from(pdfData));
```

### CLI での簡単実行

CLI からも同様にコマンド 1 つで Markdown から PDF を作成できます：

```bash
# 基本変換（目次・ブックマーク自動生成）
npx wasm-html-to-image progress-report.md -o progress-report.pdf

# テンプレート・アクセントカラー・スタンプを指定
npx wasm-html-to-image progress-report.md -o progress-report.pdf --template report --accent "#1e40af" --stamp 社外秘
```


