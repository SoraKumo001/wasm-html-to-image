import { useCallback, useEffect, useRef, useState } from "react";
import {
  render,
  LogLevel,
  type HtmlToImageOptions,
  type RenderDiagnostics,
} from "wasm-html-to-image/workers";

/** What one conversion needs: the page and the render options that go with it (template header and footer, ...). */
export interface PdfRequest {
  html: string;
  width: number;
  /** Extra render options, e.g. `pdfHeader`, `pdfFooter`, `pdfTitle` of a template. */
  options?: Partial<HtmlToImageOptions>;
}

export interface PdfRenderState {
  /** True while a conversion is running. */
  busy: boolean;
  /** The finished PDF as a Blob URL (revoked when replaced or on unmount). */
  url: string | null;
  bytes: Uint8Array | null;
  /** Milliseconds the last conversion took. */
  time: number | null;
  error: string | null;
  diagnostics: RenderDiagnostics | null;
  logs: { level: LogLevel; message: string }[];
}

const CACHE_NAME = "wasm-html-to-image-resource-cache";

/**
 * Converts a page to a PDF in the render worker and keeps the result: one conversion at a time wins
 * (a result that arrives after a newer request is dropped), the Blob URL of the previous PDF is
 * revoked, fonts and images fetched while drawing go through Cache Storage like the HTML playground.
 */
export function usePdfRender() {
  const [state, setState] = useState<PdfRenderState>({
    busy: false,
    url: null,
    bytes: null,
    time: null,
    error: null,
    diagnostics: null,
    logs: [],
  });
  const latest = useRef(0);
  const urlRef = useRef<string | null>(null);

  const revoke = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  useEffect(() => revoke, []);

  const convert = useCallback(async (request: PdfRequest) => {
    const id = ++latest.current;
    setState((s) => ({ ...s, busy: true, error: null, diagnostics: null, logs: [] }));
    const started = performance.now();
    try {
      const result = await render({
        value: request.html,
        width: request.width,
        format: "pdf",
        diagnostics: true,
        onDiagnostics: (report) => {
          if (id === latest.current) setState((s) => ({ ...s, diagnostics: report }));
        },
        logLevel: LogLevel.Info,
        onLog: (level, message) => {
          if (id === latest.current) setState((s) => ({ ...s, logs: [...s.logs, { level, message }] }));
        },
        resolveResource: async (url, fallback) => {
          if (id !== latest.current) return null;
          const cache = await caches.open(CACHE_NAME);
          const hit = await cache.match(url);
          if (hit) return new Uint8Array(await hit.arrayBuffer());
          const data = await fallback();
          if (data?.length) await cache.put(url, new Response(data as BodyInit));
          return data;
        },
        ...request.options,
      });
      if (id !== latest.current) return; // a newer conversion superseded this one
      const bytes = result.data as Uint8Array;
      revoke();
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/pdf" }));
      urlRef.current = url;
      setState((s) => ({ ...s, busy: false, url, bytes, time: performance.now() - started }));
    } catch (e) {
      if (id !== latest.current) return;
      setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  return { ...state, convert };
}
