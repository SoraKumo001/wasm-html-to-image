import { render } from "wasm-html-to-image/workerd";

export const runtime = "edge";
export const dynamic = "force-dynamic";

let cachedModule: WebAssembly.Module | undefined;

// NOTE: Next.js cannot provide a pre-compiled WebAssembly.Module object the
// way Cloudflare's `import wasm from "*.wasm"` does (the static import above
// only yields an asset URL here), so the edge route compiles the Module
// itself from bytes served by this app and passes it explicitly — the same
// `instantiateWasm` override path as `workerd.ts`.
async function getWasmModule(baseUrl: string): Promise<WebAssembly.Module> {
  if (!cachedModule) {
    const url = `${baseUrl}/api/wasm-glue-wasm`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wasm fetch failed: ${res.status} @ ${url}`);
    cachedModule = await WebAssembly.compile(await res.arrayBuffer());
  }
  return cachedModule;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const baseUrl = new URL(req.url).origin;
    const out = await render(
      { value: "<h1>e2e edge</h1>", width: 800, format: "png" },
      await getWasmModule(baseUrl),
    );
    const bytes =
      out.data instanceof Uint8Array
        ? out.data
        : new TextEncoder().encode(out.data);
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "image/png" },
    });
  } catch (e) {
    return new Response(
      `edge render failed: ${String((e as Error)?.message ?? e)}`,
      { status: 500 },
    );
  }
}
