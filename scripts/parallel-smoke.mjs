// Worker-pool parallel smoke (reproducible).
// Usage: node scripts/parallel-smoke.mjs [test-image-path]
// Compares N mixed render jobs run sequentially (single render) vs
// concurrently through the worker-lib pool (maxParallel=4):
//   - all jobs must succeed with valid magics (PNG 89PNG / WebP RIFF)
//   - concurrent wall time SHOULD be less than sequential wall time, but the
//     timing comparison is warn-only (environment-dependent, flaky on
//     loaded/cold machines).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDir = path.join(repoRoot, "packages", "html-to-image", "dist");
const defaultImg = path.join(
  repoRoot,
  "packages",
  "visual-test",
  "assets",
  "images",
  "image01.jpg",
);
const imgPath = process.argv[2] ?? defaultImg;
const jpg = fs.readFileSync(imgPath);

const N_HTML = 6;
const N_IMG = 6;
const MAX_PARALLEL = 4;

const makeJobs = () => [
  ...Array.from({ length: N_HTML }, (_, i) => ({
    value: `<h1>parallel ${i}</h1>`,
    width: 800,
    height: 600,
    format: "png",
  })),
  ...Array.from({ length: N_IMG }, () => ({
    value: new Uint8Array(jpg),
    format: "webp",
    quality: 80,
  })),
];

const checkMagic = (out, format) => {
  if (!(out instanceof Uint8Array)) throw new Error(`not bytes for ${format}`);
  const head = Buffer.from(out.subarray(0, 4));
  if (format === "png" && !head.toString("hex").startsWith("89504e47")) {
    throw new Error(`png magic mismatch: ${head.toString("hex")}`);
  }
  if (format === "webp" && head.toString("latin1") !== "RIFF") {
    throw new Error(`webp magic mismatch: ${head.toString("hex")}`);
  }
};

const { render: singleRender } = await import(
  pathToFileURL(path.join(distDir, "single.js")).href
);
const { createHtmlToImageWorker } = await import(
  pathToFileURL(path.join(distDir, "workers.js")).href
);

// Sequential baseline (single connection).
const tSeqStart = Date.now();
for (const job of makeJobs()) {
  const res = await singleRender(job);
  checkMagic(res.data, job.format);
}
const seqMs = Date.now() - tSeqStart;

// Concurrent pool run.
const pool = createHtmlToImageWorker({ maxParallel: MAX_PARALLEL });
const tParStart = Date.now();
const outputs = await Promise.all(makeJobs().map((job) => pool.render(job)));
const parMs = Date.now() - tParStart;
for (const [i, res] of outputs.entries()) {
  checkMagic(res.data, i < N_HTML ? "png" : "webp");
}
const stats = pool.getStats();
await pool.waitAll();
pool.close();

const jobsOk = stats.completedJobs === N_HTML + N_IMG && stats.failedJobs === 0;
const faster = parMs < seqMs;
if (jobsOk && !faster) {
  console.log(
    `WARNING: parallel (${parMs}ms) not faster than sequential (${seqMs}ms); timing is environment-dependent, not a failure.`,
  );
}
const pass = jobsOk;
console.log(
  JSON.stringify(
    { jobs: N_HTML + N_IMG, maxParallel: MAX_PARALLEL, seqMs, parMs, stats },
    null,
    2,
  ),
);
console.log(`sequential: ${seqMs}ms, parallel(x${MAX_PARALLEL}): ${parMs}ms`);
console.log(
  `stats: completed=${stats.completedJobs} failed=${stats.failedJobs} avg=${Math.round(stats.avgJobTimeMs)}ms`,
);
console.log(pass ? "PARALLEL SMOKE: PASS" : "PARALLEL SMOKE: FAIL");
process.exit(pass ? 0 : 1);
