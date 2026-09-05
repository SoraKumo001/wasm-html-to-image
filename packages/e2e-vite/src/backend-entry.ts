import { render } from "wasm-html-to-image/single";

/** SSR/middleware entry: render HTML to PNG bytes (Node-safe). */
export async function handleRender(): Promise<Uint8Array> {
  const out = await render({ value: "<h1>e2e backend</h1>", width: 800, format: "png" });
  return out instanceof Uint8Array ? out : new TextEncoder().encode(out);
}
