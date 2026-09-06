---
sidebar_position: 4
title: 複数ページ PDF 帳票・レポート生成
---

# 複数ページ PDF 帳票・レポート生成

**wasm-html-to-image** は、HTML 文字列の配列 (`string[]`) を入力として受け取り、複数ページのベクター PDF ドキュメントを出力できます。

## 実装例

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

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
const pdfBuffer = await render({
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
