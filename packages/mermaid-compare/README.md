# mermaid-compare

Interactive comparison app comparing [`wasm-html-to-image`](https://www.npmjs.com/package/wasm-html-to-image)'s native Mermaid diagram renderer with the official [`mermaid`](https://www.npmjs.com/package/mermaid) package.

---

## 🌟 Features

- **Side-by-Side & Split Slider Views**:
  - Compare diagram layout, node spacing, font rendering, and arrow routing side-by-side or using a real-time draggable overlay slider.
- **Support for Key Diagram Types**:
  - Pre-configured presets for Flowcharts, Sequence Diagrams, Class Diagrams, State Diagrams, ER Diagrams, and Charts (Pie, XY Chart).
- **Theme Testing**:
  - Compare themes: `light`, `dark`, `neutral`, `forest`, `nord`, `dracula`, `sepia`, etc.
- **Performance Profiling**:
  - Real-time conversion latency comparison (ms) between WASM and DOM/D3-based rendering.
- **Recovery & Tolerant Parsing**:
  - Test `wasm-html-to-image`'s `mode: "strict" | "compat" | "recover"` with syntax deviations and view recovery/warning logs.
- **Multi-Format Export**:
  - Export diagram outputs directly as SVG or raster formats (PNG, WebP).

---

## 🚀 Getting Started

This package is part of the monorepo and uses the local `wasm-html-to-image` build (`workspace:*`),
so rebuild the library (`pnpm build` in `packages/html-to-image`, or `pnpm build` at the root) to see engine changes.

From the repository root:

```bash
# Run local dev server
pnpm --filter mermaid-compare dev

# Build production bundle
pnpm --filter mermaid-compare build
```

Then open `http://localhost:3001` in your browser.

Open `http://localhost:3001/parity.html` for the theme colour report: it renders every preset in `light`, `dark`,
`forest` and `neutral` with both renderers and lists the colour difference (CIE76 ΔE) of node, edge and text
colours, plus the official theme variables (`window.__parity`). See `doc/design/mermaid-theme-parity.md`.
