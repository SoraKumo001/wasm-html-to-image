---
sidebar_position: 6
title: CLI Tool
---

# Command Line Interface (CLI)

Run `wasm-html-to-image` directly from your terminal or CI pipelines without writing code.

## Usage

```bash
npx wasm-html-to-image <input> [options]
```

## Options

| Option               | Flag |   Default   | Description                                                              |
| -------------------- | :--: | :---------: | ------------------------------------------------------------------------ |
| `--output <path>`    | `-o` | Input based | Target output path                                                       |
| `--width <number>`   | `-w` |    `800`    | Viewport width                                                           |
| `--height <number>`  | `-h` |   `auto`    | Viewport height                                                          |
| `--format <format>`  | `-f` |    `png`    | Format (`svg`, `png`, `pdf`, `jpeg`, `webp`, `avif`, `jxl`, `raw`, `thumbhash`) |
| `--quality <number>` | `-q` |    `85`     | Encode quality 0–100                                                     |

## Examples

```bash
# Render local HTML to WebP
npx wasm-html-to-image template.html -o card.webp -w 1200 -h 630 -f webp -q 90

# Capture screenshot from URL
npx wasm-html-to-image https://example.com -o site.png -w 1280 -h 720
```
