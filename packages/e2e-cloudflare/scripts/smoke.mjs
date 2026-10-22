// HTTP smoke assertions for the e2e-cloudflare worker (previously a vitest
// suite): PNG magic + length, SVG string, invalid input rejected with 400.
// The `cf dev` start/wait/stop plumbing lives in scripts/cf-smoke.mjs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  expectPng,
  expectStatus,
  runCfSmoke,
} from "../../../scripts/cf-smoke.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.exitCode = await runCfSmoke({
  pkgDir,
  checks: [
    // 1. PNG magic + length
    (base) => expectPng(base, "/png"),
    // 2. SVG string
    async (base) => {
      const res = await fetch(`${base}/svg`);
      assert(res.status === 200, `GET /svg status=${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      assert(ct.includes("image/svg+xml"), `GET /svg content-type=${ct}`);
      const text = await res.text();
      assert(text.length > 0, "GET /svg empty body");
      assert(text.toLowerCase().includes("<svg"), "GET /svg missing <svg marker");
      console.log(`svg: ${text.length} chars`);
    },
    // 3. Invalid input rejected with 400
    (base) => expectStatus(base, "/invalid", 400),
  ],
});
