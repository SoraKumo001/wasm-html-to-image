---
sidebar_position: 2
title: render() & Options
---

# render() & Options Reference

`render()` is the primary function for converting HTML or raw images into the target format.

## Signatures

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

:::note Return Type
Returns a `string` for `svg` format, and `Uint8Array` for all other formats (`png`, `jpeg`, `webp`, `avif`, `jxl`, `pdf`, `raw`, `thumbhash`).
:::

---

## Options (`HtmlToImageOptions`)

### Core Options

| Option    | Type                                              |   Default    | Description                                                              |
| --------- | ------------------------------------------------- | :----------: | ------------------------------------------------------------------------ |
| `value`   | `string \| string[] \| Uint8Array \| ArrayBuffer` |      -       | Input data (HTML string, HTML array for multi-page PDF, or image buffer) |
| `url`     | `string`                                          |      -       | URL to fetch and render when `value` is omitted                          |
| `baseUrl` | `string`                                          |      -       | Base URL for resolving relative assets                                   |
| `width`   | `number`                                          | **Required** | Viewport width (HTML) or target output width (image)                     |
| `height`  | `number`                                          |    `auto`    | Viewport height (HTML) or target output height (image)                   |
| `format`  | `OutputFormat`                                    |   `"png"`    | Target output format (`png`, `jpeg`, `webp`, `avif`, `jxl`, `raw`, `thumbhash`, `svg`, `pdf`) |

### Encoding & Resizing

| Option      | Type                                                      | Default | Description                                  |
| ----------- | --------------------------------------------------------- | :-----: | -------------------------------------------- |
| `quality`   | `number`                                                  |  `85`   | Compression quality 0–100 (JPEG, WebP, AVIF) |
| `speed`     | `number`                                                  |   `6`   | Encoding speed 0–10 (primarily for AVIF)     |
| `fit`       | `"contain" \| "cover" \| "fill"`                          |    -    | Resize fit strategy                          |
| `crop`      | `{ x: number, y: number, width: number, height: number }` |    -    | Cropping bounding rectangle                  |
| `animation` | `boolean`                                                 | `false` | Preserve animation frames where supported    |

### Fonts & Styling

| Option          | Type                                      |      Default       | Description                                            |
| --------------- | ----------------------------------------- | :----------------: | ------------------------------------------------------ |
| `fontMap`       | `Record<string, string>`                  | `DEFAULT_FONT_MAP` | Map of generic family names to Google Fonts URLs       |
| `fallbackFonts` | `(Uint8Array \| ArrayBuffer \| string)[]` |        `[]`        | User-supplied fallback fonts                           |
| `fonts`         | `{ name: string, data: Uint8Array }[]`    |        `[]`        | Named fonts pre-loaded on the instance                 |
| `css`           | `string`                                  |         -          | Additional custom CSS string injected before discovery |
| `mediaType`     | `"screen" \| "print"`                     |     `"screen"`     | Target media type for CSS `@media` rules               |
| `textToPaths`   | `boolean`                                 |       `true`       | Outline text as SVG paths                              |
