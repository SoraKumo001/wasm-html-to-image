"use client";

import { useEffect, useState } from "react";
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image";

declare global {
  interface Window {
    __e2e?: unknown;
  }
}

// NOTE: the published `/single` entry resolves glue/wasm relative to its own
// dist files, which bundlers do not preserve. The fixture therefore serves
// the exact dist files over HTTP (see app/api/wasm-glue) and points the
// loader at them explicitly — same engine, bundler-safe addressing.
async function run(): Promise<unknown> {
  const mod = await loadHtmlToImageModule({
    glueUrl: "/api/wasm-glue-js",
    locateFile: () => "/api/wasm-glue-wasm",
  });
  const out = await htmlToImage(mod, {
    value: "<h1>e2e next</h1>",
    width: 800,
    format: "png",
  });
  const bytes = out instanceof Uint8Array ? out : new TextEncoder().encode(out);
  return {
    ok: true,
    len: bytes.length,
    head: [bytes[0], bytes[1], bytes[2], bytes[3]],
  };
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
  return <main>e2e: {state}</main>;
}
