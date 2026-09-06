import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Runs the tests inside the real Workers runtime (workerd) via Miniflare.
// The workerd entry carries its own pre-compiled WASM module via static
// import, so no bindings or wrangler config are needed. The `CompiledWasm`
// rule teaches Miniflare to load the `.wasm` artifact as a
// `WebAssembly.Module` instead of parsing it as JavaScript.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"] }],
      },
    }),
  ],
  test: {
    pool: "@cloudflare/vitest-pool-workers",
  },
});
