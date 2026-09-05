import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

// Serves the exact published .wasm over HTTP (see wasm-glue-js/route.ts).
function distFile(): string {
  const distDir = process.env.WASM_HTML_TO_IMAGE_DIST;
  if (!distDir) {
    throw new Error("WASM_HTML_TO_IMAGE_DIST is not set");
  }
  return path.join(distDir, "html-to-image.wasm");
}

export async function GET(): Promise<Response> {
  try {
    const data = await fs.readFile(distFile());
    return new Response(data as unknown as BodyInit, {
      headers: { "Content-Type": "application/wasm" },
    });
  } catch (e) {
    return new Response(`wasm not found: ${String((e as Error)?.message ?? e)}`, {
      status: 404,
    });
  }
}
