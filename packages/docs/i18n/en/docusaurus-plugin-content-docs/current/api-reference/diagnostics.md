---
sidebar_position: 7
title: Diagnostics & Logging
---

# Diagnostics & Logging

Monitor rendering performance and debug failed resource fetches.

## Log Levels

```typescript
import { render, LogLevel } from "wasm-html-to-image/single";

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

---

## Diagnostics Report

```typescript
import { render } from "wasm-html-to-image/single";

await render({
  value: `<img src="https://example.com/photo.png" />`,
  width: 800,
  format: "webp",
  diagnostics: true,
  onDiagnostics: (report) => {
    console.log("Total time:", report.totalDurationMs, "ms");
    console.log("Resolved fonts:", report.fonts.length);
    console.log("Fetched images:", report.resources.length);
  },
});
```
