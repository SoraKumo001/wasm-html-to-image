export { BrowserSession, type BrowserSessionOptions } from "./browser-session.js";
export { PageSession, type PageSessionOptions } from "./page-session.js";
export { startCdpServer, type CdpServer, type CdpServerOptions } from "./ws-server.js";
export type {
  CDPError,
  CDPEvent,
  CDPRequest,
  CDPResponse,
  ConnectionTransport,
} from "./protocol.js";

import { BrowserSession, type BrowserSessionOptions } from "./browser-session.js";
import type { ConnectionTransport } from "./protocol.js";

/**
 * Create a Puppeteer-compatible `ConnectionTransport` backed by `wasm-quickjs-dom`.
 *
 * ```ts
 * import puppeteer from "puppeteer-core";
 * import { createCdpTransport } from "wasm-html-to-image-cdp";
 *
 * const browser = await puppeteer.connect({ transport: createCdpTransport() });
 * const page = await browser.newPage();
 * await page.setContent("<h1>Hello</h1>");
 * console.log(await page.evaluate(() => document.querySelector("h1")?.textContent));
 * await browser.close();
 * ```
 */
export function createCdpTransport(options?: BrowserSessionOptions): ConnectionTransport {
  return new BrowserSession(options).createTransport();
}
