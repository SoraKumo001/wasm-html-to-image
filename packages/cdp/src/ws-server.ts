import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { BrowserSession, type BrowserSessionOptions } from "./browser-session.js";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWebSocket(socket: Duplex, session: BrowserSession): void {
  const transport = session.createTransport();
  let closed = false;
  let buffer = Buffer.alloc(0);
  let fragmentedChunks: Buffer[] = [];
  let fragmentedOpcode = 0;

  transport.onmessage = (msg: string) => {
    if (!closed && !socket.destroyed) {
      socket.write(encodeWsFrame(0x1, Buffer.from(msg, "utf8")));
    }
  };
  transport.onclose = () => {
    if (!closed && !socket.destroyed) {
      closed = true;
      try {
        socket.end(encodeWsFrame(0x8, Buffer.alloc(0)));
      } catch {
        socket.destroy();
      }
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i & 3];
        }
        payload = unmasked;
      }
      buffer = buffer.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x8) {
        closed = true;
        transport.close();
        socket.destroy();
        return;
      }
      if (opcode === 0x9) {
        if (!socket.destroyed) socket.write(encodeWsFrame(0xA, payload));
        continue;
      }
      if (opcode === 0xA) continue;

      if (opcode !== 0x0) {
        fragmentedOpcode = opcode;
        fragmentedChunks = [payload];
      } else {
        fragmentedChunks.push(payload);
      }

      if (fin && fragmentedOpcode === 0x1) {
        const text = Buffer.concat(fragmentedChunks).toString("utf8");
        fragmentedChunks = [];
        fragmentedOpcode = 0;
        transport.send(text);
      }
    }
  });

  socket.on("close", () => {
    if (!closed) {
      closed = true;
      transport.close();
    }
  });
  socket.on("error", () => {
    if (!closed) {
      closed = true;
      transport.close();
    }
  });
}

export interface CdpServerOptions extends BrowserSessionOptions {
  port?: number;
  host?: string;
}

export interface CdpServer {
  readonly port: number;
  readonly host: string;
  readonly httpUrl: string;
  readonly wsUrl: string;
  close(): Promise<void>;
}

/**
 * Start a lightweight WebSocket + HTTP CDP server (like Cloudflare Kitesurf's endpoint)
 * so external Puppeteer clients can connect via `puppeteer.connect({ browserWSEndpoint })`
 * or `puppeteer.connect({ browserURL })`.
 */
export async function startCdpServer(options: CdpServerOptions = {}): Promise<CdpServer> {
  const host = options.host ?? "127.0.0.1";
  const sessions = new Set<BrowserSession>();
  let port = options.port ?? 0;

  const server: Server = createServer((req: IncomingMessage, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];
    if (urlPath === "/json/version") {
      const body = JSON.stringify({
        Browser: "wasm-html-to-image/0.1",
        "Protocol-Version": "1.3",
        "User-Agent": "Mozilla/5.0 (wasm-html-to-image) AppleWebKit/537.36",
        "V8-Version": "QuickJS-ng",
        webSocketDebuggerUrl: `ws://${host}:${port}/devtools/browser`,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (urlPath === "/json" || urlPath === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + WS_MAGIC).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    const session = new BrowserSession(options);
    sessions.add(session);
    socket.on("close", () => sessions.delete(session));
    attachWebSocket(socket, session);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });

  return {
    port,
    host,
    httpUrl: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}/devtools/browser`,
    close: async () => {
      for (const s of sessions) s.close();
      sessions.clear();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
