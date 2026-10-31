import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  server: {
    port: 3001,
  },
  optimizeDeps: {
    exclude: ["wasm-html-to-image", "worker-lib"],
  },
  plugins: [tailwindcss(), react()],
});
