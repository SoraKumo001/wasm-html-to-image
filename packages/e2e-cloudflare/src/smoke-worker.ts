import { render } from "wasm-html-to-image/workerd";
import { markdownToDocument, markdownToHtml } from "wasm-html-to-image/markdown";
import { katexMath } from "wasm-html-to-image/markdown-math";

/**
 * Minimal worker that exercises the workerd entry over HTTP.
 * Used by scripts/smoke.mjs via `cf dev` (no fixed port).
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
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "image/png" },
      });
    }

    if (url.pathname === "/svg") {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "svg",
      });
      return new Response(out.data, {
        headers: { "Content-Type": "image/svg+xml" },
      });
    }

    if (url.pathname === "/pdf") {
      const out = await render({ value: "<h1>hi</h1>", width: 600, format: "pdf" });
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    // Markdown -> styled HTML (marked + highlight.js bundled into the worker) -> PDF.
    if (url.pathname === "/markdown-pdf") {
      const html = markdownToHtml(
        "---\ntitle: Worker\n---\n\n# Hello\n\n```ts\nconst a: number = 1;\n```\n",
        { paged: true },
      );
      const out = await render({ value: html, width: 600, format: "pdf" });
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    // A template (cover, contents, running header and footer) from Markdown, as a PDF, inside the worker.
    if (url.pathname === "/markdown-template") {
      const md = ["---", "title: Worker report", "author: W", "---", "", "# One", "", "text", "", "# Two", "", "text", ""].join("\n");
      const { html, renderOptions } = markdownToDocument(md, { template: "report", paged: true });
      const out = await render({ value: html, format: "pdf", ...renderOptions });
      return new Response(out.data as BodyInit, { headers: { "Content-Type": "application/pdf" } });
    }

    // Maths in Markdown: KaTeX bundled into the worker, its fonts fetched from the CDN while drawing.
    // The reply is the PNG's height, which a typeset display fraction makes far taller than its source text.
    if (url.pathname === "/markdown-math") {
      const md = String.raw`$$\frac{a}{b}$$`;
      const heightOf = async (html: string) => {
        const out = await render({ value: html, width: 300, format: "png" });
        return new DataView((out.data as Uint8Array).buffer, (out.data as Uint8Array).byteOffset).getUint32(20);
      };
      const typeset = await heightOf(markdownToHtml(md, { math: katexMath() }));
      const plain = await heightOf(markdownToHtml(md));
      return Response.json({ typeset, plain });
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
