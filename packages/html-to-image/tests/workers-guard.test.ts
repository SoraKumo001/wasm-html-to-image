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
    ["object without postMessage", {}],
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
});
