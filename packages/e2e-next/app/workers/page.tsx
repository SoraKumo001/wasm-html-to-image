"use client";

import { useEffect, useState } from "react";
import { createHtmlToImageWorker } from "wasm-html-to-image/workers";

declare global {
  interface Window {
    __e2e?: unknown;
  }
}

// Workers cell: same engine as the direct web cell, but rendering runs in
// a Web Worker through the `wasm-html-to-image/workers` pool. Uses the
// default pool, which resolves to the pre-bundled `web-workers.js`
// (SINGLE_FILE inlined, no .wasm fetch needed) in browsers.
async function run(): Promise<unknown> {
  const pool = createHtmlToImageWorker({ maxParallel: 2 });
  try {
    const res = await pool.render({
      value: "<h1>e2e workers</h1>",
      width: 800,
      format: "png",
    });
    const bytes =
      res.data instanceof Uint8Array
        ? res.data
        : new TextEncoder().encode(res.data);
    return {
      ok: true,
      len: bytes.length,
      head: [bytes[0], bytes[1], bytes[2], bytes[3]],
    };
  } finally {
    pool.close();
  }
}

export default function Page() {
  const [state, setState] = useState("running");
  useEffect(() => {
    run().then(
      (result) => {
        window.__e2e = result;
        setState("done");
      },
      (e) => {
        window.__e2e = { ok: false, error: String(e) };
        setState("failed");
      },
    );
  }, []);
  return <main>e2e workers: {state}</main>;
}
