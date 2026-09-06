---
sidebar_position: 7
title: ログ & 診断 (Diagnostics)
---

# ログ & 診断 (Diagnostics)

レンダリングパイプラインの詳細な追跡、パフォーマンス測定、リソース取得エラーのデバッグを行うための機能です。

## ログレベルと `onLog`

`logLevel` オプションにより、TypeScript 層および WASM ネイティブ層のログ出力を制御できます。

```typescript
import { render, LogLevel } from "wasm-html-to-image";

await render({
  value: "<h1>Debugging</h1>",
  width: 800,
  format: "png",
  logLevel: LogLevel.Debug,
  onLog: (level, message) => {
    console.log(`[${LogLevel[level]}] ${message}`);
  },
});
```

### ログレベル一覧

- `None`: ログ出力を完全に無効化（既定値）
- `Error`: 致命的なエラーのみ通知
- `Warn`: リソース取得失敗や代替フォント適用などの警告
- `Info`: 各処理ステージの開始・完了
- `Debug`: 詳細なパラメータ、計測タイミング
- `Trace`: 最も詳細なトレース情報

---

## 診断レポート (`RenderDiagnostics`)

`diagnostics: true` を指定すると、フォント解決結果、画像リソースの読み込み成否、各処理ステージの所要時間を含む完全なレポートが生成されます。

```typescript
import { render } from "wasm-html-to-image";

await render({
  value: `<img src="https://example.com/logo.png" />`,
  width: 800,
  format: "webp",
  diagnostics: true,
  onDiagnostics: (report) => {
    console.log("総所要時間:", report.totalDurationMs, "ms");
    console.log("解決されたフォント数:", report.fonts.length);
    console.log("取得された画像数:", report.resources.length);

    // 失敗したリソースのチェック
    for (const res of report.resources) {
      if (!res.success) {
        console.warn(`リソース取得失敗: ${res.url} (${res.error})`);
      }
    }
  },
});
```
