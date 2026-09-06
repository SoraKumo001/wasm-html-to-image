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
    const res = await render({
      value: "<h1>e2e vite</h1>",
      width: 800,
      format: "png",
    });
    const bytes =
      res.data instanceof Uint8Array
        ? res.data
        : new TextEncoder().encode(res.data);
    window.__e2e = {
      ok: true,
      len: bytes.length,
      head: [bytes[0], bytes[1], bytes[2], bytes[3]],
    };
  } catch (e) {
    window.__e2e = { ok: false, error: String(e) };
  }
})();
