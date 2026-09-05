import { loadWorkerLib } from "./worker-lib-loader.js";
import type { HtmlToImageWorker } from "./child-workers.js";
export type { HtmlToImageWorker } from "./child-workers.js";
import { type HtmlToImageOptions, type WorkerPoolStats } from "./core.js";
export type { HtmlToImageOptions, WorkerPoolStats } from "./core.js";

// worker-lib's published ESM is broken under plain Node (see
// worker-lib-loader.ts); top-level await keeps call sites sync-shaped.
const { createWorker, Worker } = await loadWorkerLib();

/**
 * Create a wasm-html-to-image worker pool using worker-lib.
 * The pooled action is the unified `render` (HTML and image inputs).
 * Each worker thread loads its own module instance via the loader
 * (modules cannot cross thread boundaries).
 *
 * @param params Initialization parameters
 * @param params.worker Optional: Path to the worker file, a URL, or a factory function.
 *                      Defaults to the bundled child-workers.js in the same directory.
 *                      (tsc-only build: no pre-bundled web-workers.js; browser apps
 *                      should either bundle child-workers.js or pass a custom worker.)
 * @param params.maxParallel Maximum number of parallel workers (default: 4)
 * @param params.timeoutMs Optional: Default timeout in milliseconds for each render job.
 *                         If a render job times out, the pool is reset to prevent hung workers.
 */
export const createHtmlToImageWorker = (params?: {
  worker?: string | URL | (() => Worker | string | URL);
  maxParallel?: number;
  timeoutMs?: number;
}) => {
  const { worker, maxParallel = 4, timeoutMs } = params ?? {};

  const factory = () => {
    let w: any;
    if (worker) {
      w = typeof worker === "function" ? worker() : worker;
    } else {
      // tsc-only build: always the compiled child-workers.js next to this file.
      const workerUrl = new URL("./child-workers.js", import.meta.url);

      if (typeof Worker !== "undefined") {
        w = new Worker(workerUrl, { type: "module" });
      }
    }

    if (!w) throw new Error("Worker is not supported in this environment.");

    return w;
  };

  const workerInstance = createWorker<HtmlToImageWorker>(factory, maxParallel);

  let totalPendingJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let totalJobTimeMs = 0;

  /**
   * Retrieve operational stats of the worker pool.
   */
  const getStats = (): WorkerPoolStats => ({
    workerCount: maxParallel,
    activeJobs: Math.min(totalPendingJobs, maxParallel),
    queuedJobs: Math.max(0, totalPendingJobs - maxParallel),
    completedJobs,
    failedJobs,
    avgJobTimeMs: completedJobs > 0 ? totalJobTimeMs / completedJobs : 0,
  });

  /**
   * Reset the worker pool by terminating all running workers and recreating them.
   * Useful to clear hung workers or reset statistics.
   */
  const reset = () => {
    workerInstance.setLimit(0);
    workerInstance.setLimit(maxParallel);
    totalPendingJobs = 0;
    completedJobs = 0;
    failedJobs = 0;
    totalJobTimeMs = 0;
  };

  const proxy = new Proxy(workerInstance, {
    get(target, prop, receiver) {
      if (prop === "getStats") {
        return getStats;
      }
      if (prop === "reset") {
        return reset;
      }
      if (prop === "render") {
        return async (options: HtmlToImageOptions) => {
          totalPendingJobs++;
          const startTime = Date.now();

          let timeoutId: any;
          let timeoutPromise: Promise<never> | undefined;

          if (timeoutMs !== undefined && timeoutMs > 0) {
            timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                // If a job times out, terminate and recreate workers to recover from a potential hang
                reset();
                reject(new Error(`Render timed out after ${timeoutMs}ms`));
              }, timeoutMs);
            });
          }

          try {
            const executePromise = target.execute("render", options as any);
            const result = await (timeoutPromise
              ? Promise.race([executePromise, timeoutPromise])
              : executePromise);

            completedJobs++;
            totalJobTimeMs += Date.now() - startTime;
            return result;
          } catch (e) {
            failedJobs++;
            throw e;
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            totalPendingJobs--;
          }
        };
      }

      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return async (...args: any[]) => {
        totalPendingJobs++;
        try {
          return await target.execute(prop as any, ...args);
        } finally {
          totalPendingJobs--;
        }
      };
    },
  }) as unknown as Omit<typeof workerInstance, "execute"> &
    HtmlToImageWorker & {
      /**
       * Retrieve operational stats of the worker pool.
       */
      getStats: () => WorkerPoolStats;
      /**
       * Reset the worker pool by terminating all running workers and recreating them.
       */
      reset: () => void;
      /**
       * Close and terminate all workers in the pool immediately.
       */
      close: () => void;
      /**
       * Wait for all running tasks in the pool to complete.
       */
      waitAll: () => Promise<void>;
      /**
       * Wait until there is an available worker slot in the pool.
       */
      waitReady: (retryTime?: number) => Promise<void>;
    };
  return proxy;
};

const defaultWorker = createHtmlToImageWorker({ maxParallel: 1 });

export const { close, render, launchWorker, setLimit, waitAll, waitReady } =
  defaultWorker;

export const reset = () => defaultWorker.reset();

export const getStats = () => defaultWorker.getStats();
