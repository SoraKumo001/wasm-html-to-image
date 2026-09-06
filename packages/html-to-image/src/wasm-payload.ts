/**
 * Compressed embedded WASM payload.
 *
 * `scripts/compress-wasm.mjs` compresses `dist/html-to-image.wasm`
 * (gzip vs brotli, smaller wins) and writes the base64 payload to
 * `dist/html-to-image-wasm.js`. This loader restores the raw bytes at
 * runtime via `DecompressionStream`, so the browser worker bundle embeds
 * ~4MB instead of the 12MB SINGLE_FILE glue.
 */
// @ts-expect-error — dist/html-to-image-wasm.js is generated at build time
import { wasmBase64, wasmEncoding } from "../dist/html-to-image-wasm.js";

/** Decompress the embedded WASM payload and return the raw bytes. */
export async function loadCompressedWasmBinary(): Promise<Uint8Array> {
  const encoding = wasmEncoding as string;
  try {
    // gzip only: the W3C Compression Standard (DecompressionStream) has no
    // "br" — see scripts/compress-wasm.mjs.
    if (encoding !== "gzip") {
      throw new Error(`unsupported wasmEncoding ${JSON.stringify(encoding)}`);
    }
    const bin = atob(wasmBase64 as string);
    const compressed = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) compressed[i] = bin.charCodeAt(i);
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream(encoding as CompressionFormat));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length === 0) {
      throw new Error("decompressed to 0 bytes");
    }
    return bytes;
  } catch (e) {
    throw new Error(
      `wasm-html-to-image: failed to restore embedded WASM ` +
        `(encoding=${JSON.stringify(encoding)}): ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}
