import { CookieJar } from "wasm-quickjs-dom";
import type { CookieJarLike, FetchLimits } from "wasm-quickjs-dom";
import { PageSession } from "./page-session.js";
import type { CDPEvent, CDPRequest, CDPResponse, ConnectionTransport } from "./protocol.js";

export interface BrowserSessionOptions {
  quickjsWasm?: WebAssembly.Module;
  limits?: FetchLimits;
  width?: number;
  height?: number;
  onUnhandledMethod?: (method: string, params?: Record<string, unknown>) => void;
}

export class BrowserSession {
  private readonly pages = new Map<string, PageSession>();
  private readonly sessionToTarget = new Map<string, string>();
  private readonly cookieJar: CookieJarLike = new CookieJar();
  private readonly options: BrowserSessionOptions;

  private targetSeq = 1;
  private sessionSeq = 1;
  private discoverTargets = false;
  private autoAttach = false;
  private closed = false;

  private sendRaw?: (msg: string) => void;
  private onCloseCallback?: () => void;

  constructor(options: BrowserSessionOptions = {}) {
    this.options = options;
  }

  createTransport(): ConnectionTransport {
    const transport: ConnectionTransport = {
      send: (raw: string) => {
        void this.handleRawMessage(raw);
      },
      close: () => {
        this.close();
      },
    };
    this.sendRaw = (msg: string) => {
      transport.onmessage?.(msg);
    };
    this.onCloseCallback = () => {
      transport.onclose?.();
    };
    return transport;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.pages.values()) {
      page.close();
    }
    this.pages.clear();
    this.sessionToTarget.clear();
    this.onCloseCallback?.();
  }

  private emitEvent = (method: string, params: Record<string, unknown>, sessionId?: string): void => {
    if (this.closed || !this.sendRaw) return;
    const ev: CDPEvent = { method, params };
    if (sessionId) ev.sessionId = sessionId;
    this.sendRaw(JSON.stringify(ev));
  };

  private sendResponse(res: CDPResponse): void {
    if (this.closed || !this.sendRaw) return;
    this.sendRaw(JSON.stringify(res));
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let req: CDPRequest;
    try {
      req = JSON.parse(raw) as CDPRequest;
    } catch {
      return;
    }
    try {
      const result = await this.dispatch(req);
      this.sendResponse({
        id: req.id,
        result: result ?? {},
        ...(req.sessionId ? { sessionId: req.sessionId } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendResponse({
        id: req.id,
        error: { code: -32000, message },
        ...(req.sessionId ? { sessionId: req.sessionId } : {}),
      });
    }
  }

  private async dispatch(req: CDPRequest): Promise<unknown> {
    if (req.sessionId) {
      const targetId = this.sessionToTarget.get(req.sessionId);
      const page = targetId ? this.pages.get(targetId) : undefined;
      if (!page) throw new Error(`Unknown session: ${req.sessionId}`);
      return await page.handleCommand(req.method, req.params);
    }

    const params = req.params ?? {};
    switch (req.method) {
      case "Browser.getVersion": {
        return {
          protocolVersion: "1.3",
          product: "wasm-html-to-image/0.1",
          revision: "0",
          userAgent: "Mozilla/5.0 (wasm-html-to-image) AppleWebKit/537.36",
          jsVersion: "QuickJS-ng",
        };
      }
      case "Browser.close": {
        setTimeout(() => this.close(), 0);
        return {};
      }
      case "Target.getBrowserContexts": {
        return { browserContextIds: [] };
      }
      case "Target.createBrowserContext": {
        return { browserContextId: "default" };
      }
      case "Target.disposeBrowserContext": {
        return {};
      }
      case "Target.setDiscoverTargets": {
        this.discoverTargets = !!params.discover;
        if (this.discoverTargets) {
          for (const page of this.pages.values()) {
            this.emitEvent("Target.targetCreated", { targetInfo: this.targetInfo(page, false) });
          }
        }
        return {};
      }
      case "Target.setAutoAttach": {
        this.autoAttach = !!params.autoAttach;
        if (this.autoAttach) {
          for (const page of this.pages.values()) {
            this.emitEvent("Target.attachedToTarget", {
              sessionId: page.sessionId,
              targetInfo: this.targetInfo(page, true),
              waitingForDebugger: false,
            });
          }
        }
        return {};
      }
      case "Target.getTargets": {
        return {
          targetInfos: Array.from(this.pages.values()).map((p) => this.targetInfo(p, true)),
        };
      }
      case "Target.createTarget": {
        const targetId = `target-${this.targetSeq++}`;
        const sessionId = `session-${this.sessionSeq++}`;
        const page = new PageSession({
          targetId,
          sessionId,
          quickjsWasm: this.options.quickjsWasm,
          cookieJar: this.cookieJar,
          limits: this.options.limits,
          width: typeof params.width === "number" ? params.width : this.options.width,
          height: typeof params.height === "number" ? params.height : this.options.height,
          emitEvent: this.emitEvent,
          onUnhandledMethod: this.options.onUnhandledMethod,
        });
        this.pages.set(targetId, page);
        this.sessionToTarget.set(sessionId, targetId);

        await page.initBlank();

        if (this.discoverTargets) {
          this.emitEvent("Target.targetCreated", { targetInfo: this.targetInfo(page, this.autoAttach) });
        }
        if (this.autoAttach) {
          this.emitEvent("Target.attachedToTarget", {
            sessionId,
            targetInfo: this.targetInfo(page, true),
            waitingForDebugger: false,
          });
        }
        return { targetId };
      }
      case "Target.attachToTarget": {
        const targetId = String(params.targetId ?? "");
        const page = this.pages.get(targetId);
        if (!page) throw new Error(`No target with id ${targetId}`);
        this.emitEvent("Target.attachedToTarget", {
          sessionId: page.sessionId,
          targetInfo: this.targetInfo(page, true),
          waitingForDebugger: false,
        });
        return { sessionId: page.sessionId };
      }
      case "Target.closeTarget": {
        const targetId = String(params.targetId ?? "");
        const page = this.pages.get(targetId);
        if (!page) return { success: false };
        page.close();
        this.pages.delete(targetId);
        this.sessionToTarget.delete(page.sessionId);
        if (this.autoAttach) {
          this.emitEvent("Target.detachedFromTarget", { sessionId: page.sessionId, targetId });
        }
        if (this.discoverTargets) {
          this.emitEvent("Target.targetDestroyed", { targetId });
        }
        return { success: true };
      }
      case "Target.activateTarget": {
        return {};
      }
      default: {
        this.options.onUnhandledMethod?.(req.method, req.params);
        return {};
      }
    }
  }

  private targetInfo(page: PageSession, attached: boolean) {
    return {
      targetId: page.targetId,
      type: "page",
      title: "",
      url: page.url,
      attached,
      canAccessOpener: false,
    };
  }
}
