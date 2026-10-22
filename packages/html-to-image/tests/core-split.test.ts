import { describe, expect, it } from "vitest";
import {
  checkResourceAllowed,
  parsePendingResources,
} from "../src/core-resources.js";

const enc = new TextEncoder();
const u32 = (n: number): Uint8Array =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

/** Multi-entry pending-resources binary. */
const pendingBin = (entries: { type: number; url: string }[]): Uint8Array => {
  const parts: Uint8Array[] = [u32(entries.length)];
  for (const e of entries) {
    const ub = enc.encode(e.url);
    parts.push(
      new Uint8Array([e.type, 0]),
      u32(ub.length),
      ub,
      u32(1),
      enc.encode("n"),
      u32(0),
    );
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("core-split: allow-list checks", () => {
  it("blocks disallowed protocols and hosts", () => {
    expect(
      checkResourceAllowed("http://a.example/x", { allowedProtocols: ["https:"] }),
    ).toBe("Protocol http: is blocked");
    expect(
      checkResourceAllowed("https://b.example/x", { allowedHosts: ["a.example"] }),
    ).toBe("Host b.example is not in allowed list");
    expect(
      checkResourceAllowed("https://evil.example/x", {
        blockedHosts: ["evil.example"],
      }),
    ).toBe("Host evil.example is blocked");
  });
});

describe("core-split: parsePendingResources", () => {
  it("decodes font/image/css entries", () => {
    const bin = pendingBin([
      { type: 1, url: "https://a.example/f.woff2" },
      { type: 2, url: "https://a.example/i.png" },
      { type: 3, url: "https://a.example/s.css" },
    ]);
    expect(parsePendingResources(bin)).toMatchObject([
      { type: "font", url: "https://a.example/f.woff2" },
      { type: "image", url: "https://a.example/i.png" },
      { type: "css", url: "https://a.example/s.css" },
    ]);
  });

  it("never throws on empty or truncated binaries", () => {
    expect(parsePendingResources(null)).toEqual([]);
    expect(parsePendingResources(undefined)).toEqual([]);
    expect(parsePendingResources(new Uint8Array([]))).toEqual([]);
    expect(parsePendingResources(new Uint8Array([1, 2]))).toEqual([]);
    const full = pendingBin([{ type: 1, url: "https://a.example/f.woff2" }]);
    expect(parsePendingResources(full.slice(0, 6))).toEqual([]);
  });
});
