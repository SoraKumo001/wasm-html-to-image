import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "e2e-cloudflare-smoke",
		compatibilityDate: "2025-02-04",
		entrypoint: "src/smoke-worker.ts",
		observability: {
			enabled: false,
		},
	},
});
