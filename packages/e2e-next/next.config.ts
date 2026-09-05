import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the WASM-adjacent package on disk so Node file URLs and node:fs
  // keep working inside Route Handlers (native ESM, no bundler rewrites).
  serverExternalPackages: ["wasm-html-to-image"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // The workerd entry statically imports the .wasm artifact. Emit it as a
    // plain asset so the edge bundle compiles; at runtime the edge route
    // passes an explicitly compiled Module instead (see edge-render).
    config.module.rules.push({
      test: /html-to-image\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
