import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Allocate a free loopback port (tiny bind race accepted, retry on clash). */
export async function ephemeralPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

/**
 * Locate a Chromium binary without the playwright npm package (not installed
 * by design): env override, then the pre-installed ms-playwright browsers.
 */
export function findChrome(): string {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const home = os.homedir();
  const candidates: string[] = [];
  for (const root of [
    path.join(home, "AppData/Local/ms-playwright"),
    path.join(home, ".cache/ms-playwright"),
    path.join(home, "Library/Caches/ms-playwright"),
  ]) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      candidates.push(
        path.join(root, e, "chrome-win64/chrome.exe"),
        path.join(root, e, "chrome-linux/chrome"),
      );
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Chromium binary not found. Install browsers or set CHROME_PATH to a chrome executable.",
  );
}

export interface ChromeHandle {
  port: number;
  close: () => Promise<void>;
}

/** Launch headless Chromium with a CDP endpoint. Caller must close(). */
export async function launchChrome(): Promise<ChromeHandle> {
  const port = await ephemeralPort();
  const proc: ChildProcess = spawn(
    findChrome(),
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  // Wait for the DevTools endpoint to answer.
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline || proc.exitCode !== null) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      throw new Error("Chromium CDP endpoint did not start");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  let closed = false;
  return {
    port,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
    },
  };
}

interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: unknown;
}

/**
 * Open `url` in a fresh page and evaluate `expression`, polling until it
 * returns a non-null value (page scripts run async). Returns the value.
 */
export async function cdpEvaluate(
  cdpPort: number,
  url: string,
  expression: string,
  timeoutMs = 90000,
): Promise<unknown> {
  const created: { webSocketDebuggerUrl: string } = (await (
    await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })
  ).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
  try {
    let id = 0;
    const pending = new Map<number, (msg: CdpMessage) => void>();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String((ev as MessageEvent).data)) as CdpMessage;
      if (typeof msg.id === "number") pending.get(msg.id)?.(msg);
    });
    const send = (method: string, params?: Record<string, unknown>): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const cur = ++id;
        pending.set(cur, (msg) => {
          pending.delete(cur);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        });
        ws.send(JSON.stringify({ id: cur, method, params }));
      });
    await send("Page.enable");
    await send("Page.navigate", { url });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = (await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      const value = res?.result?.value ?? null;
      if (value !== null && value !== undefined) return value;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for page expression: ${expression}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    ws.close();
  }
}
