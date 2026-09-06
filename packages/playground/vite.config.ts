import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sample HTML assets are borrowed from packages/visual-test/assets
// (no copy from satoru; served via /assets alias like satoru's vite.config).
const visualTestAssets = path.resolve(__dirname, "../visual-test/assets");

export default defineConfig({
  base: "./",
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: ["..", visualTestAssets],
    },
  },
  resolve: {
    alias: {
      "/assets": visualTestAssets,
    },
  },
  // WASM supply needs no extra config: the default pool resolves the
  // pre-bundled dist/web-workers.js (self-contained, SINGLE_FILE inlined)
  // via `new URL("./web-workers.js", import.meta.url)` in workers-parent.
  // `optimizeDeps` exclusion keeps that runtime URL resolution working in
  // dev exactly as in the built output (same idiom as e2e-vite).
  optimizeDeps: {
    exclude: ["wasm-html-to-image", "worker-lib"],
  },
  plugins: [
    tailwindcss(),
    react(),

    {
      name: "handle-visual-test-assets",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/assets/")) {
            const urlPath = req.url.split("?")[0];
            const assetPath = path.join(
              visualTestAssets,
              decodeURIComponent(urlPath.substring("/assets/".length)),
            );
            if (fs.existsSync(assetPath) && fs.lstatSync(assetPath).isFile()) {
              res.setHeader("Content-Type", getMimeType(assetPath));
              res.end(fs.readFileSync(assetPath));
              return;
            }
          }
          next();
        });
      },
      closeBundle() {
        const distDir = path.resolve(__dirname, "dist");
        if (!fs.existsSync(distDir)) return;
        // assets directory
        const destAssets = path.resolve(distDir, "assets");
        if (fs.existsSync(visualTestAssets)) {
          copyRecursiveSync(visualTestAssets, destAssets);
          console.log(`Copied visual-test/assets/ to dist/assets/`);
        }
      },
    },
    {
      name: "watch-external-assets",
      configureServer(server) {
        server.watcher.add(visualTestAssets);
        server.watcher.on("change", (file) => {
          if (file.startsWith(visualTestAssets)) {
            server.ws.send({ type: "full-reload" });
          }
        });
      },
    },
  ],
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});

function copyRecursiveSync(src: string, dest: string) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName),
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
  };
  return mimes[ext] || "application/octet-stream";
}
