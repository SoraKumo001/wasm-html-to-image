import { loadWorkerLib } from "./worker-lib-loader.js";
import type { HtmlToImageWorker } from "./child-workers.js";
export type { HtmlToImageWorker } from "./child-workers.js";
import { type HtmlToImageOptions } from "./core.js";
export type { HtmlToImageOptions } from "./core.js";

/** Operational stats of the worker pool. */
export interface WorkerPoolStats {
  /** Number of workers in the pool */
  workerCount: number;
  /** Jobs currently being executed */
  activeJobs: number;
  /** Jobs waiting for a free worker */
  queuedJobs: number;
  /** Total jobs completed successfully since start */
  completedJobs: number;
  /** Total jobs that failed since start */
  failedJobs: number;
  /** Average time per job in milliseconds */
  avgJobTimeMs: number;
}

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
 *                      Defaults to the pre-bundled browser worker
 *                      (`./web-workers.js`, SINGLE_FILE inlined) when
 *                      `window` exists, else the Node worker
 *                      (`./child-workers.js`) next to this file.
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
      // child-workers.js = Node worker; web-workers.js = pre-bundled
      // browser worker (SINGLE_FILE inlined, no .wasm fetch needed).
      const workerUrl =
        typeof window !== "undefined"
          ? new URL("./web-workers.js", import.meta.url)
          : new URL("./child-workers.js", import.meta.url);

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
      // No generic `execute` forwarding: only the explicit pool API above
      // (render/getStats/reset) plus worker-lib's own methods (close,
      // launchWorker, setLimit, waitAll, waitReady) are available.
      // Returning undefined (instead of throwing) keeps `await pool` working.
      return undefined;
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

type DefaultWorker = ReturnType<typeof createHtmlToImageWorker>;

let defaultWorker: DefaultWorker | undefined;

/** Lazily create the shared single-slot pool on first use (not at import). */
function getDefaultWorker(): DefaultWorker {
  if (!defaultWorker) {
    defaultWorker = createHtmlToImageWorker({ maxParallel: 1 });
  }
  return defaultWorker;
}

export const close = (): void => {
  getDefaultWorker().close();
};

export const render = (
  options: HtmlToImageOptions,
): Promise<Uint8Array | string> => getDefaultWorker().render(options);

export const launchWorker = (): Promise<void[]> =>
  getDefaultWorker().launchWorker();

export const setLimit = (limit: number): void => {
  getDefaultWorker().setLimit(limit);
};

export const waitAll = (): Promise<void> => getDefaultWorker().waitAll();

export const waitReady = (retryTime?: number): Promise<void> =>
  getDefaultWorker().waitReady(retryTime);

export const reset = (): void => {
  getDefaultWorker().reset();
};

export const getStats = (): WorkerPoolStats => getDefaultWorker().getStats();
