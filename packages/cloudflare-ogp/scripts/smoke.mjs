// Smoke test for cloudflare-ogp via `wrangler dev` + HTTP assertions.
// - Starts `wrangler dev` on a random free port (no fixed ports).
// - Waits up to 60s for the worker to become ready.
// - Asserts `GET /?title=Hello` returns image/png with PNG magic + >100B.
// - Asserts `GET /not-found` returns 404.
// - Always kills the wrangler child process; exits non-zero on failure.
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PKG_DIR = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const READY_TIMEOUT_MS = 60_000;
const PNG_MAGIC = "89504e47";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function headHex(bytes) {
  return Array.from(bytes.subarray(0, 4))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

async function waitForReady(port, child, deadline) {
  // Ready = worker answers on a cheap route. Poll /not-found (expects 404
  // once the worker code is running; connection errors mean "not yet").
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `wrangler dev exited early (code=${child.exitCode} signal=${child.signalCode})`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for wrangler dev to become ready");
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/not-found`);
      // Any HTTP response (404 expected) means workerd is serving.
      await res.arrayBuffer().catch(() => {});
      if (res.status === 404) return;
      // A 200/other status also means the server is up; keep waiting a bit
      // for the expected 404 route to settle, but don't fail yet.
      await sleep(500);
    } catch {
      await sleep(500);
    }
  }
}

async function main() {
  const port = await getFreePort();
  console.log(`[smoke] starting wrangler dev on port ${port}`);
  // Spawn wrangler via node on its JS entry (avoids .cmd/shell quirks on
  // Windows so `child.kill()` reliably terminates the actual process).
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../package.json", import.meta.url));
  const wranglerPkg = require.resolve("wrangler/package.json");
  const wranglerEntry = path.join(path.dirname(wranglerPkg), "bin", "wrangler.js");
  const child = spawn(process.execPath, [wranglerEntry, "dev", "--port", String(port)], {
    cwd: PKG_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });
  let tail = "";
  const onData = (d) => {
    const s = String(d);
    tail += s;
    if (tail.length > 20000) tail = tail.slice(-20000);
    process.stdout.write(`[wrangler] ${s}`);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => console.error(`[smoke] wrangler spawn error: ${e.message}`));

  const kill = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const done = () => resolve();
      child.once("exit", done);
      child.kill("SIGTERM");
      // Force-kill if it lingers (Windows often ignores SIGTERM).
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === "win32" && child.pid) {
              const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
                stdio: "ignore",
              });
              killer.on("exit", done);
              setTimeout(done, 3000);
            } else {
              child.kill("SIGKILL");
              setTimeout(done, 3000);
            }
          } catch {
            done();
          }
        }
      }, 5000);
    });

  try {
    await waitForReady(port, child, Date.now() + READY_TIMEOUT_MS);
    console.log(`[smoke] wrangler dev ready on port ${port}`);

    // 1) PNG render check.
    const pngRes = await fetch(
      `http://127.0.0.1:${port}/?title=${encodeURIComponent("Hello")}`,
    );
    const contentType = pngRes.headers.get("content-type") ?? "";
    const pngBuf = new Uint8Array(await pngRes.arrayBuffer());
    console.log(
      `[smoke] GET /?title=Hello -> ${pngRes.status} content-type=${contentType} bytes=${pngBuf.length} head=${headHex(pngBuf)}`,
    );
    if (pngRes.status !== 200) throw new Error(`expected 200 for /?title=Hello, got ${pngRes.status}`);
    if (!contentType.toLowerCase().includes("image/png")) {
      throw new Error(`expected Content-Type image/png, got ${JSON.stringify(contentType)}`);
    }
    if (headHex(pngBuf) !== PNG_MAGIC) {
      throw new Error(`expected PNG magic ${PNG_MAGIC}, got ${headHex(pngBuf)}`);
    }
    if (pngBuf.length <= 100) {
      throw new Error(`expected PNG >100B, got ${pngBuf.length}B`);
    }

    // 2) 404 check.
    const nfRes = await fetch(`http://127.0.0.1:${port}/not-found`);
    await nfRes.arrayBuffer().catch(() => {});
    console.log(`[smoke] GET /not-found -> ${nfRes.status}`);
    if (nfRes.status !== 404) {
      throw new Error(`expected 404 for /not-found, got ${nfRes.status}`);
    }

    console.log("[smoke] all assertions passed");
  } catch (err) {
    console.error(`[smoke] FAILED: ${err?.stack ?? err}`);
    console.error(`[smoke] wrangler log tail:\n${tail.slice(-4000)}`);
    process.exitCode = 1;
  } finally {
    await kill();
  }
}

await main();
