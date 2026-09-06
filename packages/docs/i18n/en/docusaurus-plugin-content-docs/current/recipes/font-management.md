---
sidebar_position: 6
title: Advanced Font Management
---

# Advanced Font Management

Eliminate tofu characters and minimize render latency with offline font assets.

## Inlining Local Fonts

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image/single";

const myFont = await fs.readFile("./fonts/MyBrandFont.ttf");

const png = await render({
  value: "<h1>Offline Brand Title</h1>",
  width: 800,
  format: "png",
  fallbackFonts: [myFont],
});
```
