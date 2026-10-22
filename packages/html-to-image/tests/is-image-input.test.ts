import { describe, expect, it } from "vitest";
import { isImageInput } from "../src/core.js";

const u8 = (arr: number[]): Uint8Array => new Uint8Array(arr);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const PNG = u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF89 = u8([...ascii("GIF89a"), 0x01, 0x00]);
const AVIF = u8([0x00, 0x00, 0x00, 0x1c, ...ascii("ftypavif")]);

describe("isImageInput: magic bytes", () => {
  const cases: [string, Uint8Array][] = [
    ["png", PNG],
    ["gif89a", GIF89],
    ["avif", AVIF],
  ];
  it.each(cases)("%s is image input", (_name, bytes) => {
    expect(isImageInput(bytes)).toBe(true);
  });

  it("throws on unknown magic bytes", () => {
    expect(() => isImageInput(u8([0x00, 0x01, 0x02, 0x03]))).toThrow(
      /unrecognized image input/,
    );
  });

  it("throws on truncated input", () => {
    expect(() => isImageInput(u8([0x89]))).toThrow(/unrecognized image input/);
    expect(() => isImageInput(u8([]))).toThrow(/unrecognized image input/);
  });
});

describe("isImageInput: strings", () => {
  it("treats data:image/ URLs as image input", () => {
    expect(isImageInput("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isImageInput("data:image/svg+xml,%3Csvg/%3E")).toBe(true);
  });

  it("treats other strings as HTML", () => {
    expect(isImageInput("<h1>hi</h1>")).toBe(false);
    expect(isImageInput("")).toBe(false);
    expect(isImageInput("data:text/html,<h1>hi</h1>")).toBe(false);
  });
});
