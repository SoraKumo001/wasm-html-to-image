import { defineConfig } from "vitest/config";

// The tests cover plain logic (src/markdownSettings.ts), so they do not use vite.config.ts: its plugins
// (React, Tailwind, the copy of the sample assets into dist/ when the bundle closes) are not wanted here.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
