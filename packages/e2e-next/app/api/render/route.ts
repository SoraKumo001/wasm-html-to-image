import fs from "node:fs/promises";
import path from "node:path";
import { htmlToImage, type HtmlToImageModule } from "wasm-html-to-image";
// NOTE: statically imported via relative path so the bundler includes the
// glue (package-subpath/deep imports would hit exports-map or resolution
// rewrites). The Emscripten factory needs no Node APIs by itself; the .wasm
// bytes are handed over explicitly below. Untyped (any) by design.
import createHtmlToImageModule from "../../../../html-to-image/dist/html-to-image.js";

export const dynamic = "force-dynamic";

function wasmPath(): string {
  const distDir = process.env.WASM_HTML_TO_IMAGE_DIST;
  if (!distDir) {
    throw new Error("WASM_HTML_TO_IMAGE_DIST is not set");
  }
  return path.join(distDir, "html-to-image.wasm");
}

export async function GET(): Promise<Response> {
  try {
    const factory = createHtmlToImageModule as (
      moduleArg?: Record<string, unknown>,
    ) => Promise<HtmlToImageModule>;
    const mod = await factory({
      wasmBinary: new Uint8Array(await fs.readFile(wasmPath())),
    });
    const out = await htmlToImage(mod, {
      value: "<h1>e2e backend</h1>",
      width: 800,
      format: "png",
    });
    const bytes = out instanceof Uint8Array ? out : new TextEncoder().encode(out);
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "image/png" },
    });
  } catch (e) {
    return new Response(`backend render failed: ${String((e as Error)?.message ?? e)}`, {
      status: 500,
    });
  }
}
