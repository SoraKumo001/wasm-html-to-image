// Generate a tiny 2-frame animated GIF locally (no network, no ffmpeg):
// solid-color frames keep LZW trivial (CLEAR per row, fixed 8-bit codes).
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("packages/visual-test/assets");

function lzwSolid(w, h, index) {
  // min code size 7 -> CLEAR=128, EOI=129, codes are 8 bits throughout
  // (row-wise CLEAR keeps the dictionary far below 256 entries).
  const bytes = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += 8;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };
  for (let y = 0; y < h; y++) {
    emit(128); // CLEAR
    for (let x = 0; x < w; x++) emit(index);
  }
  emit(129); // EOI
  if (bits > 0) bytes.push(acc & 255);
  // sub-block chunking (<=255B each) + terminator
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const part = bytes.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return Buffer.from(out);
}

function frame(w, h, index, delayCs) {
  const gce = Buffer.from([0x21, 0xf9, 0x04, 0x08, delayCs & 255, (delayCs >> 8) & 255, 0, 0]);
  const desc = Buffer.alloc(10);
  desc[0] = 0x2c;
  desc.writeUInt16LE(w, 5);
  desc.writeUInt16LE(h, 7);
  return Buffer.concat([gce, desc, Buffer.from([7]), lzwSolid(w, h, index)]);
}

const W = 64;
const H = 64;
const header = Buffer.from("GIF89a", "latin1");
const lsd = Buffer.alloc(7);
lsd.writeUInt16LE(W, 0);
lsd.writeUInt16LE(H, 2);
lsd[4] = 0xf6; // GCT flag + 128 entries (2^(6+1))
const gct = Buffer.alloc(128 * 3);
gct[0] = 255; // index 0: red
gct[1] = 0;
gct[2] = 0;
gct[3] = 0; // index 1: blue
gct[4] = 0;
gct[5] = 255;
const netscape = Buffer.from([
  ...Buffer.from("NETSCAPE2.0", "latin1"),
]);
const appExt = Buffer.concat([
  Buffer.from([0x21, 0xff, 0x0b]),
  netscape,
  Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
]);

const gif = Buffer.concat([
  header,
  lsd,
  gct,
  appExt,
  frame(W, H, 0, 50),
  frame(W, H, 1, 50),
  Buffer.from([0x3b]),
]);
fs.writeFileSync(path.join(dir, "anim-2f.gif"), gif);
console.log("anim-2f.gif", gif.length);
