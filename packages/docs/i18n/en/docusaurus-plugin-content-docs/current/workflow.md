---
sidebar_position: 4
title: Development Workflow
---

# Development Workflow

Guide to repository setup, build scripts, test suites, and documentation previewing.

## 1. Setup

```bash
pnpm install
```

## 2. Building

### TypeScript Packages

```bash
# Build html-to-image package
pnpm --filter wasm-html-to-image build

# Build all monorepo packages
pnpm build:js
```

### WASM Native Module (C++)

Requires CMake and Emscripten SDK:

```bash
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
cmake --build build --target html-to-image
```

---

## 3. Testing

### Unit Tests (Vitest)

```bash
pnpm --filter wasm-html-to-image test
```

### Visual Regression Tests

```bash
pnpm --filter visual-test test
```

---

## 4. Documentation Site

```bash
# Start local development server with live reload
pnpm docs:dev

# Build static documentation files
pnpm docs:build

# Preview built production site
pnpm --filter wasm-html-to-image-docs serve
```
