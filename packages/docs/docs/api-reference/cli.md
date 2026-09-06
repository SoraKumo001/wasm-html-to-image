---
sidebar_position: 6
title: CLI ツール
---

# コマンドラインツール (CLI)

`wasm-html-to-image` は、ターミナルから直接 HTML や画像を高速に変換できるコマンドラインインターフェース（CLI）を提供します。

`npx` で即座に実行できるほか、グローバルインストールやスクリプト内での利用が可能です。

## 基本的な構文

```bash
npx wasm-html-to-image <input> [options]
```

`<input>` には、ローカルの HTML ファイルパス、画像ファイルパス、または Web URL を指定できます。

---

## オプション一覧

| オプション           | 短縮形 |    既定値     | 説明                                                                       |
| -------------------- | :----: | :-----------: | -------------------------------------------------------------------------- |
| `--output <path>`    |  `-o`  |  入力名準拠   | 出力先ファイルパス                                                         |
| `--width <number>`   |  `-w`  |     `800`     | ビューポート幅（px）                                                       |
| `--height <number>`  |  `-h`  | 自動 (`auto`) | ビューポート高さ（px）                                                     |
| `--format <format>`  |  `-f`  |     `png`     | 出力形式 (`svg`, `png`, `pdf`, `jpeg`, `webp`, `avif`, `raw`, `thumbhash`) |
| `--quality <number>` |  `-q`  |     `85`      | 圧縮品質 (0〜100、エンコード形式のみ有効)                                  |

---

## 使用例

### 1. ローカル HTML を WebP に変換

```bash
npx wasm-html-to-image template.html -o card.webp -w 1200 -h 630 -f webp -q 90
```

### 2. URL からスクリーンショット (PNG) を生成

```bash
npx wasm-html-to-image https://example.com -o site.png -w 1280 -h 720
```

### 3. 画像ファイルを AVIF に圧縮・リサイズ

```bash
npx wasm-html-to-image banner.png -o banner.avif -w 800 -f avif -q 80
```

### 4. HTML から PDF を作成

```bash
npx wasm-html-to-image invoice.html -o invoice.pdf -w 800 -f pdf
```
