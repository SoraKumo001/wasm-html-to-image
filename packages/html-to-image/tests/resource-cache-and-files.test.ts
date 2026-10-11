import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("keys remote entries by User-Agent", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    await fetchResourceBytes("https://c.example/b", undefined, "UA-1");
    await fetchResourceBytes("https://c.example/b", undefined, "UA-2");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("evicts least-recently-used entries past the entry cap", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    await fetchResourceBytes("https://c.example/first");
    for (let i = 0; i < 300; i++) {
      await fetchResourceBytes(`https://c.example/fill-${i}`);
    }
    f.mockClear();
    await fetchResourceBytes("https://c.example/first"); // evicted -> refetch
    expect(f).toHaveBeenCalledTimes(1);
    f.mockClear();
    await fetchResourceBytes("https://c.example/fill-299"); // recent -> cached
    expect(f).not.toHaveBeenCalled();
  });
});

describe("confineFiles (opt-in)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2i-confine-"));
  const base = join(dir, "site");
  mkdirSync(base);
  writeFileSync(join(base, "in.txt"), "in");
  writeFileSync(join(dir, "secret.txt"), "secret");

  it("reads outside baseUrl by default (unchanged behavior)", async () => {
    const bytes = await fetchResourceBytes("../secret.txt", base);
    expect(bytes && new TextDecoder().decode(bytes)).toBe("secret");
  });

  it("allows files inside baseUrl", async () => {
    const bytes = await fetchResourceBytes(
      "in.txt", base, undefined, undefined, undefined, true,
    );
    expect(bytes && new TextDecoder().decode(bytes)).toBe("in");
  });

  it("refuses ../ escapes", async () => {
    expect(
      await fetchResourceBytes(
        "../secret.txt", base, undefined, undefined, undefined, true,
      ),
    ).toBeNull();
  });

  it("refuses bare filesystem paths when there is no baseUrl", async () => {
    const abs = join(dir, "secret.txt");
    expect(await fetchResourceBytes(abs)).not.toBeNull();
    clearResourceCache();
    expect(
      await fetchResourceBytes(abs, undefined, undefined, undefined, undefined, true),
    ).toBeNull();
  });

  afterEach(() => undefined);
  it("cleanup", () => rmSync(dir, { recursive: true, force: true }));
});
