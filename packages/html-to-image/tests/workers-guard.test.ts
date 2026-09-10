import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtmlToImageWorker } from "../src/workers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Invalid worker values must trip the isWorkerFactoryResult guard. */
function poolWithBadWorker(value: unknown) {
  return createHtmlToImageWorker({
    worker: (() => value) as unknown as () => never,
    maxParallel: 1,
  });
}

describe("workers: isWorkerFactoryResult guard", () => {
  it.each([
    ["number", 42],
    ["null", null],
    ["object without postMessage", {}],
    ["object with non-function postMessage", { postMessage: "x" }],
    ["undefined", undefined],
  ])("rejects launchWorker for %s", async (_name, value) => {
    const pool = poolWithBadWorker(value);
    try {
      await expect(pool.launchWorker()).rejects.toThrow(
        "Worker is not supported in this environment.",
      );
    } finally {
      pool.close();
    }
  });

  it("rejects render and records failedJobs, reset clears stats", async () => {
    const pool = poolWithBadWorker(42);
    try {
      await expect(
        pool.render({ value: "<h1>hi</h1>", width: 100 }),
      ).rejects.toThrow("Worker is not supported in this environment.");
      const stats = pool.getStats();
      expect(stats.workerCount).toBe(1);
      expect(stats.failedJobs).toBe(1);
      expect(stats.completedJobs).toBe(0);
      pool.reset();
      const cleared = pool.getStats();
      expect(cleared.failedJobs).toBe(0);
      expect(cleared.completedJobs).toBe(0);
      expect(cleared.activeJobs).toBe(0);
      expect(cleared.queuedJobs).toBe(0);
      expect(cleared.avgJobTimeMs).toBe(0);
    } finally {
      pool.close();
    }
  });

  it("clears the timeout timer when execute fails fast", async () => {
    const pool = createHtmlToImageWorker({
      worker: (() => null) as unknown as () => never,
      maxParallel: 1,
      timeoutMs: 10_000,
    });
    try {
      await expect(
        pool.render({ value: "<h1>hi</h1>", width: 100 }),
      ).rejects.toThrow("Worker is not supported in this environment.");
    } finally {
      pool.close();
    }
  });
});

describe("workers: render option buffer protection", () => {
  it("does not detach the caller Uint8Array", async () => {
    const pool = poolWithBadWorker(0);
    const input = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    try {
      await expect(
        pool.render({ value: input, width: 100 }),
      ).rejects.toThrow("Worker is not supported");
      expect(input.length).toBe(4);
    } finally {
      pool.close();
    }
  });

  it("copies ArrayBuffer values before execute", async () => {
    const pool = poolWithBadWorker(0);
    const input = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    try {
      await expect(
        pool.render({ value: input, width: 100 }),
      ).rejects.toThrow("Worker is not supported");
      expect(input.byteLength).toBe(4);
    } finally {
      pool.close();
    }
  });

  it("passes string values through untouched", async () => {
    const pool = poolWithBadWorker(0);
    try {
      await expect(
        pool.render({ value: "<h1>hi</h1>", width: 100 }),
      ).rejects.toThrow("Worker is not supported");
    } finally {
      pool.close();
    }
  });
});

describe("workers: pool bookkeeping without spawning", () => {
  it("reports initial stats and closes cleanly", () => {
    const pool = createHtmlToImageWorker({
      worker: "./dummy-worker.js",
      maxParallel: 2,
    });
    try {
      expect(pool.getStats()).toMatchObject({
        workerCount: 2,
        activeJobs: 0,
        queuedJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        avgJobTimeMs: 0,
      });
    } finally {
      pool.close();
    }
  });

  it("accepts a URL worker value without invoking the builder", () => {
    const pool = createHtmlToImageWorker({
      worker: new URL("https://example.com/worker.js"),
      maxParallel: 1,
    });
    try {
      expect(pool.getStats().workerCount).toBe(1);
    } finally {
      pool.close();
    }
  });
});
