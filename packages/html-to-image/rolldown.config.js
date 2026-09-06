import { defineConfig } from "rolldown";

const shared = {
  output: {
    format: "esm",
    codeSplitting: false,
  },
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  // Keep Node builtins external; bundle everything else (notably
  // worker-lib) so the browser pre-bundle works without resolution.
  external: [/node:.*/, "worker_threads"],
};

export default defineConfig([
  {
    ...shared,
    input: "src/browser-workers.ts",
    output: {
      ...shared.output,
      file: "dist/web-workers.js",
    },
  },
  {
    ...shared,
    input: "src/workers.ts",
    output: {
      ...shared.output,
      file: "dist/workers-parent.js",
    },
  },
]);
