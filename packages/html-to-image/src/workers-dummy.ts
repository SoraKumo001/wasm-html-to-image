/**
 * workerd fallback for `./workers`: no thread pool on Workers, so jobs run
 * directly on the workerd entry point instead of being pooled.
 */
export type { HtmlToImageWorker } from "./child-workers.js";
export type {
  HtmlToImageOptions,
  OutputFormat,
  RenderOptions,
  WorkerPoolStats,
} from "./core.js";
export { getDefaultModule, render } from "./workerd.js";

export const setLimit = (_limit: number): void => {};
export const close = () => {};
export const waitAll = () => Promise.resolve();
export const waitReady = (_retryTime?: number) => Promise.resolve();
export const launchWorker = () => Promise.resolve();
