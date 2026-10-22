import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResourceCache,
  fetchResourceBytes,
} from "../src/core-resources.js";

afterEach(() => {
  vi.unstubAllGlobals();
  clearResourceCache();
});

const okFetch = () =>
  vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
  }));

describe("resource cache", () => {
  it("serves repeated fetches from the cache", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    await fetchResourceBytes("https://c.example/a", undefined, "UA");
    await fetchResourceBytes("https://c.example/a", undefined, "UA");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("confineFiles (opt-in)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2i-confine-"));
  const base = join(dir, "site");
  mkdirSync(base);
  writeFileSync(join(base, "in.txt"), "in");
  writeFileSync(join(dir, "secret.txt"), "secret");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses ../ escapes", async () => {
    expect(
      await fetchResourceBytes(
        "../secret.txt", base, undefined, undefined, undefined, true,
      ),
    ).toBeNull();
  });
});
