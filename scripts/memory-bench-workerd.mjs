// Memory benchmark inside a real workerd isolate (via the e2e-cloudflare worker's /memory
// endpoint): the engine's Wasm heap — the dominant, never-shrinking term of an isolate's
// footprint — sampled around repeated renders, with and without module recycling.
// The Node-side companion is scripts/memory-bench.mjs (process RSS there, Wasm heap here).
//
// Usage: node scripts/memory-bench-workerd.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, runCfSmoke } from "./cf-smoke.mjs";

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "e2e-cloudflare",
);

const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

async function sample(base, query) {
  const res = await fetch(`${base}/memory?${query}`);
  assert(res.status === 200, `GET /memory?${query} status=${res.status}`);
  return res.json();
}

process.exitCode = await runCfSmoke({
  pkgDir,
  checks: [
    async (base) => {
      const plain = await sample(base, "renders=10");
      console.log(
        `no recycle:   start=${mib(plain.start)} peak=${mib(plain.peak)} end=${mib(plain.end)} renders=${plain.renders}`,
      );
      const recycled = await sample(base, "renders=10&recycle=3");
      console.log(
        `recycle @3:   start=${mib(recycled.start)} peak=${mib(recycled.peak)} end=${mib(recycled.end)} renders=${recycled.renders} instanceReplaced=${recycled.recycled}`,
      );
      assert(recycled.recycled, "expected the recycle policy to replace the module instance");
      assert(
        plain.peak > plain.start,
        `the large render should have grown the heap (start=${plain.start}, peak=${plain.peak})`,
      );
      assert(
        recycled.end < plain.end,
        `recycled end heap ${recycled.end} should be below the unrecycled ${plain.end} (the ratchet was not reset)`,
      );
    },
  ],
});
