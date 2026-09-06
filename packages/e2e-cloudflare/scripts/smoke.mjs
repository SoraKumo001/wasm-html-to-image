// Spawns `wrangler dev` on a random free port, runs HTTP smoke assertions
// equivalent to the old vitest cases (PNG magic + length / SVG string /
// invalid-input reject), then always kills wrangler. No fixed ports.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(scriptsDir, "..");

const READY_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 180_000;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port =
        typeof addr === "object" && addr !== null ? addr.port : undefined;
      if (!port) {
        server.close(() => reject(new Error("could not allocate port")));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function stop(child, output) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      // Kill the whole process tree (wrangler spawns workerd children).
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        const done = () => resolve();
        killer.on("exit", done);
        killer.on("error", done);
        setTimeout(done, 10_000);
      });
    } else {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((resolve) => {
          child.on("exit", () => resolve(true));
        }),
        delay(10_000).then(() => false),
      ]);
      if (!exited) child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  if (output.length > 0) {
    console.log("--- wrangler output (tail) ---");
    console.log(output.slice(-4000));
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

async function waitForReady(base) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError;
  for (;;) {
    try {
      const res = await fetch(`${base}/invalid`, {
        signal: AbortSignal.timeout(5000),
      });
      // Any HTTP response means workerd is up (400 = invalid rejected).
      await res.text().catch(() => "");
      return;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `wrangler dev not ready within ${READY_TIMEOUT_MS}ms: ${lastError}`,
      );
    }
    await delay(1000);
  }
}

const port = await getFreePort();
const base = `http://127.0.0.1:${port}`;
// NOTE: .cmd shims (npx.cmd) cannot be spawned directly on Windows
// (EINVAL), so use the shell with a single command string there.
// `port` is a locally allocated number, safe to interpolate.
const child =
  process.platform === "win32"
    ? spawn(`npx wrangler dev --port ${port} --ip 127.0.0.1`, {
        cwd: pkgDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      })
    : spawn(
        "npx",
        ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1"],
        {
          cwd: pkgDir,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        },
      );

let output = "";
child.stdout.on("data", (d) => {
  output += String(d);
});
child.stderr.on("data", (d) => {
  output += String(d);
});
child.on("error", (e) => {
  output += `\n[spawn error] ${e}\n`;
});

let failed = false;
try {
  // Fail fast if wrangler exits before becoming ready.
  const earlyExit = new Promise((_, reject) => {
    child.on("exit", (code, signal) => {
      reject(
        new Error(
          `wrangler dev exited early (code=${code} signal=${signal})\n${output.slice(-4000)}`,
        ),
      );
    });
  });
  await Promise.race([waitForReady(base), earlyExit]);

  // 1. PNG magic + length
  {
    const res = await fetch(`${base}/png`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert(res.status === 200, `GET /png status=${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    assert(ct.includes("image/png"), `GET /png content-type=${ct}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const headHex = Array.from(bytes.subarray(0, 4))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    assert(headHex === "89504e47", `GET /png magic=${headHex}`);
    assert(bytes.length > 100, `GET /png length=${bytes.length}`);
    console.log(`png: ${bytes.length}B`);
  }

  // 2. SVG string
  {
    const res = await fetch(`${base}/svg`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    assert(res.status === 200, `GET /svg status=${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    assert(ct.includes("image/svg+xml"), `GET /svg content-type=${ct}`);
    const text = await res.text();
    assert(text.length > 0, "GET /svg empty body");
    assert(
      text.toLowerCase().includes("<svg"),
      `GET /svg missing <svg marker (${text.length} chars)`,
    );
    console.log(`svg: ${text.length} chars`);
  }

  // 3. Invalid input rejected with 400
  {
    const res = await fetch(`${base}/invalid`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await res.text().catch(() => "");
    assert(res.status === 400, `GET /invalid status=${res.status}`);
    console.log("invalid: 400 ok");
  }

  console.log("smoke: all assertions passed");
} catch (e) {
  failed = true;
  console.error(String(e?.stack ?? e));
  console.error("--- wrangler output (tail) ---");
  console.error(output.slice(-4000));
  process.exitCode = 1;
} finally {
  await stop(child, failed ? output : "");
  // Give the OS a moment to release the port / reap children.
  await delay(1000);
}
