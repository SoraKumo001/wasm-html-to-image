import { render } from "wasm-html-to-image/single";

declare global {
  interface Window {
    __e2e?: unknown;
  }
}

// Browser entry: render on page load, expose only small metadata
// (never full bytes — keeps CDP payloads tiny).
(async () => {
  try {
    const out = await render({ value: "<h1>e2e vite</h1>", width: 800, format: "png" });
    const bytes = out instanceof Uint8Array ? out : new TextEncoder().encode(out);
    window.__e2e = {
      ok: true,
      len: bytes.length,
      head: [bytes[0], bytes[1], bytes[2], bytes[3]],
    };
  } catch (e) {
    window.__e2e = { ok: false, error: String(e) };
  }
})();
