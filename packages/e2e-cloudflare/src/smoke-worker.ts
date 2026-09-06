import { render } from "wasm-html-to-image/workerd";

/**
 * Minimal worker that exercises the workerd entry over HTTP.
 * Used by scripts/smoke.mjs via `wrangler dev` (no fixed port).
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/png") {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "png",
      });
      return new Response(out as BodyInit, {
        headers: { "Content-Type": "image/png" },
      });
    }

    if (url.pathname === "/svg") {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "svg",
      });
      return new Response(out as string, {
        headers: { "Content-Type": "image/svg+xml" },
      });
    }

    if (url.pathname === "/invalid") {
      try {
        await render({ width: 800, format: "png" } as never);
      } catch {
        return new Response("bad request", { status: 400 });
      }
      return new Response("expected render to throw", { status: 500 });
    }

    return new Response("not found", { status: 404 });
  },
};
