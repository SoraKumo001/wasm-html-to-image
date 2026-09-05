import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

// Serves the exact published glue JS over HTTP so browser bundles can
// address it with a stable URL (bundlers do not preserve the dist-relative
// layout that the loader defaults rely on). Static route (not [...path]:
// edge-sandbox internal fetch does not reach catch-all routes).
function distFile(): string {
  const distDir = process.env.WASM_HTML_TO_IMAGE_DIST;
  if (!distDir) {
    throw new Error("WASM_HTML_TO_IMAGE_DIST is not set");
  }
  return path.join(distDir, "html-to-image.js");
}

export async function GET(): Promise<Response> {
  try {
    const data = await fs.readFile(distFile());
    return new Response(data as unknown as BodyInit, {
      headers: { "Content-Type": "text/javascript" },
    });
  } catch (e) {
    return new Response(`glue not found: ${String((e as Error)?.message ?? e)}`, {
      status: 404,
    });
  }
}
