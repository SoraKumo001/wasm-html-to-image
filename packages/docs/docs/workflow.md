---
sidebar_position: 4
title: 開発ワークフロー
---

# 開発ワークフロー

**wasm-html-to-image** の開発環境セットアップ、ビルド、テスト、ドキュメントプレビューの手順です。

## 1. リポジトリのセットアップ

モノレポ管理には `pnpm` (>=9) を使用しています。

```bash
# 依存パッケージのインストール
pnpm install
```

---

## 2. ビルド

### TypeScript パッケージのビルド

TypeScript コードの型チェックとバンドル（Rolldown）を実行します。

```bash
# packages/html-to-image のビルド
pnpm --filter wasm-html-to-image build

# 全パッケージの一括ビルド
pnpm build:js
```

### WASM バイナリのビルド (C++)

C++ コードの変更をビルドするには、CMake と Emscripten SDK (emsdk) が必要です。

```bash
# CMake 設定と Emscripten ビルド (環境変数や CMakeLists.txt に準拠)
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
cmake --build build --target html-to-image
```

---

## 3. テストの実行

### 単体テスト (Vitest)

```bash
pnpm --filter wasm-html-to-image test
```

### 視覚回帰テスト (Visual Regression Test)

HTML から実際に画像を生成し、ゴールデン画像とのピクセル差分を検証します。

```bash
pnpm --filter visual-test test
```

### E2E テスト

Cloudflare Workers、Next.js、Vite 環境での動作を各 E2E パッケージで検証します。

```bash
pnpm --filter e2e-cloudflare test
pnpm --filter e2e-next test
pnpm --filter e2e-vite test
```

---

## 4. ドキュメントのプレビュー

ドキュメントサイト（本サイト）は Docusaurus で構築されています。

```bash
# 開発サーバーの起動 (ホットリロード対応)
pnpm docs:dev

# ドキュメントのビルド検証
pnpm docs:build

# ビルド成果物のローカルプレビュー
pnpm --filter wasm-html-to-image-docs serve
```
