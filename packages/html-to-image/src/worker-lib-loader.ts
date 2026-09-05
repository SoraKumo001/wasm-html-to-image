import type * as WorkerLibTypes from "worker-lib";

export interface WorkerLib {
  createWorker: typeof WorkerLibTypes.createWorker;
  initWorker: typeof WorkerLibTypes.initWorker;
  Worker: typeof WorkerLibTypes.Worker;
}

let cached: Promise<WorkerLib> | undefined;

/**
 * Load worker-lib, tolerating its broken native-ESM build: the published
 * `dist/esm/*.js` uses extensionless relative imports (`./pool`), which
 * throw `ERR_MODULE_NOT_FOUND` under plain Node (2.2.0/2.2.1; upstream
 * dodges this via bundler resolution). Plain Node falls back to the CJS
 * build via `createRequire`, which resolves fine.
 *
 * No `@vite-ignore` on the first import so bundlers still substitute the
 * browser build for browser targets.
 */
export function loadWorkerLib(): Promise<WorkerLib> {
  if (!cached) {
    cached = (async () => {
      try {
        return (await import("worker-lib")) as unknown as WorkerLib;
      } catch {
        const mod = await import(/* @vite-ignore */ "node:module");
        return mod.createRequire(import.meta.url)("worker-lib") as WorkerLib;
      }
    })();
    // A rejected load must not poison the cache; allow a later retry.
    cached.catch(() => {
      resetWorkerLib();
    });
  }
  return cached;
}

/** Drop the cached load (e.g. after a failed load) so it can be retried. */
export function resetWorkerLib(): void {
  cached = undefined;
}
