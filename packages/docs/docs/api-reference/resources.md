---
sidebar_position: 4
title: フォント & リソース解決
---

# フォント & リソース解決

HTML 描画では、外部画像やフォントファイルの読み込みが不可欠です。**wasm-html-to-image** は柔軟なリソース解決と強力なキャッシュ機構を備えています。

## 1. フォント解決の仕組み

```mermaid
flowchart TD
    CSS[HTML/CSS 内のフォント指定] --> Check{フォント種別}
    Check -->|@font-face 宣言あり| FetchDirect[指定URLからフォント取得]
    Check -->|汎用名 sans-serif 等| FontMap[fontMap により Google Fonts URL に変換]
    Check -->|未登録 Web フォント| Fallback[fallbackFonts / システム代替フォント]

    FetchDirect --> CacheCheck{プロセス内キャッシュ?}
    FontMap --> CacheCheck
    Fallback --> CacheCheck

    CacheCheck -->|キャッシュ命中| Apply[WASM に即座に投入]
    CacheCheck -->|ミス| Network[HTTP/HTTPS 取得] --> SaveCache[キャッシュ保存] --> Apply
```

---

## 2. Google Fonts の自動解決

特別な設定をしなくても、一般的な CSS 指定（例: `font-family: sans-serif` や `font-family: "Noto Sans JP"`）は自動的に Google Fonts から WOFF2 形式で取得されます。

取得時の HTTP リクエストには、最新の WOFF2 フォーマットを取得するために最適な Chrome 互換の `User-Agent` が自動適用されます。

```typescript
import { render } from "wasm-html-to-image";

const { data } = await render({
  value: `<div style="font-family: 'Noto Serif JP', serif;">
    日本語の明朝体テキスト
  </div>`,
  width: 800,
  format: "png",
});
```

---

## 3. カスタムフォントの直接投入 (`fallbackFonts` & `fonts`)

インターネット接続のない閉域網や、独自ブランドフォントを使用したい場合は、フォントバイナリを直接オプションで渡します。

### `fallbackFonts`

すべてのテキスト描画のフォールバックとして機能します。

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";

const fontData = await fs.readFile("./fonts/MyCustomFont.ttf");

const { data } = await render({
  value: "<h1>独自のカスタムフォント</h1>",
  width: 800,
  format: "png",
  fallbackFonts: [fontData],
});
```

### `fonts` (名前付きフォント)

特定のフォント名と紐付けて事前登録します。

```typescript
const { data } = await render({
  value: `<h1 style="font-family: 'MyBrandFont';">ブランドタイトル</h1>`,
  width: 800,
  format: "png",
  fonts: [
    {
      name: "MyBrandFont",
      data: fontData,
    },
  ],
});
```

---

## 4. 外部画像リソースの解決

HTML 内の `<img>` や CSS `background-image: url(...)` に指定された URL は自動的に抽出され、描画前に並行フェッチされます。

- **相対 URL**: `baseUrl` オプションを指定することで、ローカルファイルパスやベースドメインからの相対パスを正しく解決します。
- **Data URL**: `data:image/png;base64,...` などのインラインデータはネットワークアクセスなしで即座にデコードされます。
- **カスタムインターセプト (`resolveResource`)**:
  特定のリソースに対して独自のフェッチ処理や認証ヘッダーの付加を行いたい場合に使用します。

```typescript
const { data } = await render({
  value: `<img src="https://example.com/private/avatar.png" />`,
  width: 400,
  format: "png",
  resolveResource: async (url) => {
    if (url.includes("/private/")) {
      const res = await fetch(url, {
        headers: { Authorization: "Bearer TOKEN" },
      });
      return new Uint8Array(await res.arrayBuffer());
    }
    return null; // 通常の取得フローに任せる
  },
});
```
