import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the WASM-adjacent package on disk so Node file URLs and node:fs
  // keep working inside Route Handlers (native ESM, no bundler rewrites).
  // NOTE: no `webpack` rule for `.wasm` is needed: the edge route imports
  // `wasm-html-to-image/workerd`, which resolves to the `edge-light` export
  // (no static `.wasm` import; the Module is compiled explicitly at runtime).
  serverExternalPackages: ["wasm-html-to-image"],
};

export default nextConfig;
