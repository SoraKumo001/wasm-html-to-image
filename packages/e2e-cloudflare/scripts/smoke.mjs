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
    // 3a. Plain HTML -> PDF (reference for the size of the Markdown one below)
    async (base) => {
      const res = await fetch(`${base}/pdf`);
      assert(res.status === 200, `GET /pdf status=${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
      assert(head === "%PDF-", `GET /pdf head=${head}`);
      console.log(`pdf: ${bytes.length} bytes`);
    },
    // 3. Markdown -> PDF inside the worker (the markdown subpath runs in workerd)
    async (base) => {
      const res = await fetch(`${base}/markdown-pdf`);
      assert(res.status === 200, `GET /markdown-pdf status=${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
      assert(head === "%PDF-", `GET /markdown-pdf head=${head}`);
      console.log(`markdown-pdf: ${bytes.length} bytes`);
    },
    // 4. Invalid input rejected with 400
    (base) => expectStatus(base, "/invalid", 400),
  ],
});
