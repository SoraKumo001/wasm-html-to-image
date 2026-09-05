import { describe, expect, it } from "vitest";
import { isImageInput } from "../src/core.js";

const u8 = (arr: number[]): Uint8Array => new Uint8Array(arr);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const PNG = u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = u8([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = u8([...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WEBP")]);
const GIF87 = u8([...ascii("GIF87a"), 0x01, 0x00]);
const GIF89 = u8([...ascii("GIF89a"), 0x01, 0x00]);
const AVIF = u8([0x00, 0x00, 0x00, 0x1c, ...ascii("ftypavif")]);
const AVIS = u8([0x00, 0x00, 0x00, 0x1c, ...ascii("ftypavis")]);
const BMP = u8([0x42, 0x4d, 0x36, 0x00]);

describe("isImageInput: magic bytes", () => {
  const cases: [string, Uint8Array][] = [
    ["png", PNG],
    ["jpeg", JPEG],
    ["webp", WEBP],
    ["gif87a", GIF87],
    ["gif89a", GIF89],
    ["avif", AVIF],
    ["avis", AVIS],
    ["bmp", BMP],
  ];
  it.each(cases)("%s is image input", (_name, bytes) => {
    expect(isImageInput(bytes)).toBe(true);
  });

  it("accepts ArrayBuffer input", () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(isImageInput(buf)).toBe(true);
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

  it("treats string arrays and nullish as HTML", () => {
    expect(isImageInput(["<h1>a</h1>", "<h1>b</h1>"])).toBe(false);
    expect(isImageInput(undefined)).toBe(false);
    expect(isImageInput(null)).toBe(false);
  });

  it("throws on unsupported input types", () => {
    expect(() => isImageInput(42)).toThrow(/unsupported input type/);
    expect(() => isImageInput({})).toThrow(/unsupported input type/);
  });
});
