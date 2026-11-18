import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { render, getDefaultModule, type OutputFormat } from "wasm-html-to-image";
import { enableLiveLayout, type LiveLayout } from "wasm-html-to-image/javascript";
import { openPage, decodeHtml, CookieJar } from "wasm-quickjs-dom";
import type { OpenedPage, QuickJSDOM, FetchLimits, CookieJarLike } from "wasm-quickjs-dom";
import { GUEST_CDP_RUNTIME_SCRIPT } from "./object-store.js";

export interface PageSessionOptions {
  targetId: string;
  sessionId: string;
  quickjsWasm?: WebAssembly.Module;
  cookieJar?: CookieJarLike;
  limits?: FetchLimits;
  width?: number;
  height?: number;
  emitEvent: (method: string, params: Record<string, unknown>, sessionId?: string) => void;
  onUnhandledMethod?: (method: string, params?: Record<string, unknown>) => void;
}

let cachedDefaultWasm: Promise<WebAssembly.Module> | undefined;

async function getDefaultQuickJSWasm(): Promise<WebAssembly.Module> {
  if (!cachedDefaultWasm) {
    cachedDefaultWasm = (async () => {
      const req = createRequire(import.meta.url);
      const wasmPath = req.resolve("wasm-quickjs-dom/quickjs.wasm");
      const bytes = await readFile(wasmPath);
      return await WebAssembly.compile(bytes as BufferSource);
    })();
  }
  return cachedDefaultWasm;
}

export class PageSession {
  readonly targetId: string;
  readonly sessionId: string;
  readonly frameId: string;
  readonly loaderIdPrefix = "loader-";

  private readonly emitEvent: PageSessionOptions["emitEvent"];
  private readonly onUnhandledMethod?: PageSessionOptions["onUnhandledMethod"];
  private readonly cookieJar: CookieJarLike;
  private readonly limits?: FetchLimits;
  private quickjsWasm?: WebAssembly.Module;

  private width: number;
  private height: number;
  private currentUrl = "about:blank";
  private loaderSeq = 1;
  private contextSeq = 1;
  private currentContextId = 0;
  private extraContextIds: number[] = [];

  private runtimeEnabled = false;
  private pageEnabled = false;
  private lifecycleEventsEnabled = false;
  private extraScripts: Map<string, { source: string; worldName?: string }> = new Map();
  private isolatedWorldNames = new Set<string>();
  private scriptSeq = 1;
  private ioStreams = new Map<string, { data: Uint8Array; offset: number }>();
  private ioSeq = 1;

  private opened?: OpenedPage;
  private dom?: QuickJSDOM;
  private liveLayout?: LiveLayout;
  private pumpTimer?: ReturnType<typeof setTimeout>;
  private pumping = false;
  private navQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: PageSessionOptions) {
    this.targetId = options.targetId;
    this.sessionId = options.sessionId;
    this.frameId = `frame-${options.targetId}`;
    this.emitEvent = options.emitEvent;
    this.onUnhandledMethod = options.onUnhandledMethod;
    this.quickjsWasm = options.quickjsWasm;
    this.cookieJar = options.cookieJar ?? new CookieJar();
    this.limits = options.limits;
    this.width = options.width ?? 800;
    this.height = options.height ?? 600;
  }

  get url(): string {
    return this.currentUrl;
  }

  async initBlank(): Promise<void> {
    await this.loadHtml("", "about:blank", false);
  }

  async handleCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) {
      throw new Error(`Target ${this.targetId} is closed`);
    }

    switch (method) {
      // --- Runtime domain ---
      case "Runtime.enable": {
        this.runtimeEnabled = true;
        if (this.currentContextId > 0) {
          this.emitExecutionContextCreated(this.currentContextId, "", true);
        }
        return {};
      }
      case "Runtime.disable": {
        this.runtimeEnabled = false;
        return {};
      }
      case "Runtime.runIfWaitingForDebugger": {
        return {};
      }
      case "Runtime.evaluate": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { evaluate: (x: unknown) => unknown } }).__cdp.evaluate(p),
          {
            expression: params.expression,
            returnByValue: !!params.returnByValue,
            awaitPromise: !!params.awaitPromise,
            objectGroup: params.objectGroup,
          },
        );
      }
      case "Runtime.callFunctionOn": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { callFunctionOn: (x: unknown) => unknown } }).__cdp.callFunctionOn(p),
          {
            functionDeclaration: params.functionDeclaration,
            objectId: params.objectId,
            arguments: params.arguments,
            returnByValue: !!params.returnByValue,
            awaitPromise: !!params.awaitPromise,
            objectGroup: params.objectGroup,
          },
        );
      }
      case "Runtime.getProperties": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { getProperties: (x: unknown) => unknown } }).__cdp.getProperties(p),
          {
            objectId: params.objectId,
            ownProperties: !!params.ownProperties,
          },
        );
      }
      case "Runtime.releaseObject": {
        if (this.dom && typeof params.objectId === "string") {
          await this.dom.eval(
            (id: string) => (globalThis as unknown as { __cdp: { releaseObject: (x: string) => void } }).__cdp.releaseObject(id),
            params.objectId,
          );
        }
        return {};
      }
      case "Runtime.releaseObjectGroup": {
        if (this.dom && typeof params.objectGroup === "string") {
          await this.dom.eval(
            (g: string) => (globalThis as unknown as { __cdp: { releaseObjectGroup: (x: string) => void } }).__cdp.releaseObjectGroup(g),
            params.objectGroup,
          );
        }
        return {};
      }
      case "Runtime.addBinding": {
        const name = typeof params.name === "string" ? params.name : "";
        if (name) {
          const dom = await this.ensureDom();
          const bridgeName = `__cdp_binding_${name}`;
          dom.expose(bridgeName, (payload: unknown) => {
            this.emit("Runtime.bindingCalled", {
              name,
              payload: typeof payload === "string" ? payload : String(payload ?? ""),
              executionContextId: this.currentContextId,
            });
          });
          await dom.eval(
            (n: string, b: string) => {
              const g = globalThis as Record<string, unknown>;
              g[n] = (arg: unknown) => (g[b] as (x: unknown) => void)(arg);
            },
            name,
            bridgeName,
          );
        }
        return {};
      }
      case "Runtime.removeBinding": {
        return {};
      }

      // --- Page domain ---
      case "Page.enable": {
        this.pageEnabled = true;
        return {};
      }
      case "Page.disable": {
        this.pageEnabled = false;
        return {};
      }
      case "Page.setLifecycleEventsEnabled": {
        this.lifecycleEventsEnabled = !!params.enabled;
        return {};
      }
      case "Page.getFrameTree": {
        return {
          frameTree: {
            frame: {
              id: this.frameId,
              loaderId: `${this.loaderIdPrefix}${this.loaderSeq}`,
              url: this.currentUrl,
              domainAndRegistry: "",
              securityOrigin: this.originOf(this.currentUrl),
              mimeType: "text/html",
            },
          },
        };
      }
      case "Page.createIsolatedWorld": {
        const ctxId = this.contextSeq++;
        this.extraContextIds.push(ctxId);
        const worldName = typeof params.worldName === "string" ? params.worldName : "";
        if (worldName) this.isolatedWorldNames.add(worldName);
        if (this.runtimeEnabled) {
          this.emitExecutionContextCreated(ctxId, worldName, false);
        }
        return { executionContextId: ctxId };
      }
      case "Page.addScriptToEvaluateOnNewDocument": {
        const id = `script-${this.scriptSeq++}`;
        const worldName = typeof params.worldName === "string" ? params.worldName : undefined;
        if (worldName) this.isolatedWorldNames.add(worldName);
        if (typeof params.source === "string") {
          this.extraScripts.set(id, { source: params.source, worldName });
        }
        return { identifier: id };
      }
      case "Page.removeScriptToEvaluateOnNewDocument": {
        if (typeof params.identifier === "string") {
          this.extraScripts.delete(params.identifier);
        }
        return {};
      }
      case "Page.navigate": {
        const url = typeof params.url === "string" ? params.url : "about:blank";
        if (url === "about:blank") {
          await this.loadHtml("", "about:blank", true);
          return { frameId: this.frameId, loaderId: `${this.loaderIdPrefix}${this.loaderSeq}` };
        }
        const { html, finalUrl } = await this.fetchPageHtml(url);
        await this.loadHtml(html, finalUrl, true);
        return { frameId: this.frameId, loaderId: `${this.loaderIdPrefix}${this.loaderSeq}` };
      }
      case "Page.setDocumentContent": {
        const html = typeof params.html === "string" ? params.html : "";
        await this.loadHtml(html, this.currentUrl, true);
        return {};
      }
      case "Page.reload": {
        if (this.currentUrl === "about:blank") {
          await this.loadHtml("", "about:blank", true);
        } else {
          const { html, finalUrl } = await this.fetchPageHtml(this.currentUrl);
          await this.loadHtml(html, finalUrl, true);
        }
        return {};
      }
      case "Page.bringToFront":
      case "Page.setInterceptFileChooserDialog":
      case "Page.getNavigationHistory": {
        if (method === "Page.getNavigationHistory") {
          return {
            currentIndex: 0,
            entries: [{ id: 1, url: this.currentUrl, userTypedURL: this.currentUrl, title: "" }],
          };
        }
        return {};
      }
      case "Page.getLayoutMetrics": {
        const vp = { pageX: 0, pageY: 0, clientWidth: this.width, clientHeight: this.height };
        const cs = { x: 0, y: 0, width: this.width, height: this.height };
        return {
          layoutViewport: vp,
          visualViewport: { ...vp, offsetX: 0, offsetY: 0, scale: 1, zoom: 1 },
          contentSize: cs,
          cssLayoutViewport: vp,
          cssVisualViewport: { ...vp, offsetX: 0, offsetY: 0, scale: 1, zoom: 1 },
          cssContentSize: cs,
        };
      }
      case "Page.captureScreenshot": {
        const dom = await this.ensureDom();
        const html = dom.serialize();
        const fmt = params.format === "jpeg" || params.format === "webp" ? params.format : "png";
        const quality = typeof params.quality === "number" ? params.quality : undefined;
        const clip = params.clip as { x?: number; y?: number; width?: number; height?: number } | undefined;
        const res = await render({
          value: html,
          baseUrl: this.currentUrl === "about:blank" ? undefined : this.currentUrl,
          width: this.width,
          height: params.captureBeyondViewport ? undefined : this.height,
          format: fmt as OutputFormat,
          ...(quality !== undefined ? { quality } : {}),
          ...(clip && typeof clip.width === "number" && typeof clip.height === "number"
            ? {
                crop: {
                  x: clip.x ?? 0,
                  y: clip.y ?? 0,
                  width: clip.width,
                  height: clip.height,
                },
              }
            : {}),
        });
        return { data: Buffer.from(res.data).toString("base64") };
      }
      case "Page.printToPDF": {
        const dom = await this.ensureDom();
        const html = dom.serialize();
        const res = await render({
          value: html,
          baseUrl: this.currentUrl === "about:blank" ? undefined : this.currentUrl,
          width: this.width,
          format: "pdf",
        });
        const bytes = typeof res.data === "string" ? Buffer.from(res.data) : res.data;
        if (params.transferMode === "ReturnAsStream") {
          const handle = `io-${this.ioSeq++}`;
          this.ioStreams.set(handle, { data: bytes, offset: 0 });
          return { stream: handle };
        }
        return { data: Buffer.from(bytes).toString("base64") };
      }
      case "IO.read": {
        const handle = String(params.handle ?? "");
        const entry = this.ioStreams.get(handle);
        if (!entry) throw new Error(`Invalid IO stream handle: ${handle}`);
        const start = typeof params.offset === "number" ? params.offset : entry.offset;
        const size = typeof params.size === "number" ? params.size : entry.data.byteLength - start;
        const end = Math.min(entry.data.byteLength, start + size);
        const chunk = entry.data.subarray(start, end);
        entry.offset = end;
        return {
          base64Encoded: true,
          data: Buffer.from(chunk).toString("base64"),
          eof: end >= entry.data.byteLength,
        };
      }
      case "IO.close": {
        const handle = String(params.handle ?? "");
        this.ioStreams.delete(handle);
        return {};
      }

      // --- DOM & Input domains ---
      case "DOM.getContentQuads": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (id: string) => (globalThis as unknown as { __cdp: { getContentQuads: (x: string) => unknown } }).__cdp.getContentQuads(id),
          String(params.objectId ?? ""),
        );
      }
      case "DOM.getBoxModel": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (id: string) => (globalThis as unknown as { __cdp: { getBoxModel: (x: string) => unknown } }).__cdp.getBoxModel(id),
          String(params.objectId ?? ""),
        );
      }
      case "DOM.describeNode": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (id: string) => (globalThis as unknown as { __cdp: { describeNode: (x: string) => unknown } }).__cdp.describeNode(id),
          String(params.objectId ?? ""),
        );
      }
      case "DOM.resolveNode": {
        const dom = await this.ensureDom();
        return await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { resolveNode: (x: unknown) => unknown } }).__cdp.resolveNode(p),
          params,
        );
      }
      case "DOM.scrollIntoViewIfNeeded": {
        return {};
      }
      case "Input.dispatchMouseEvent": {
        const dom = await this.ensureDom();
        await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { dispatchMouseEvent: (x: unknown) => void } }).__cdp.dispatchMouseEvent(p),
          params,
        );
        return {};
      }
      case "Input.dispatchKeyEvent": {
        const dom = await this.ensureDom();
        await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { dispatchKeyEvent: (x: unknown) => void } }).__cdp.dispatchKeyEvent(p),
          params,
        );
        return {};
      }
      case "Input.insertText": {
        const dom = await this.ensureDom();
        await dom.eval(
          (p: unknown) => (globalThis as unknown as { __cdp: { insertText: (x: unknown) => void } }).__cdp.insertText(p),
          params,
        );
        return {};
      }

      // --- Emulation / Network / Log / Security / DOM no-ops ---
      case "Emulation.setDeviceMetricsOverride": {
        const nextW = typeof params.width === "number" ? params.width : this.width;
        const nextH = typeof params.height === "number" ? params.height : this.height;
        const changed = nextW !== this.width || nextH !== this.height;
        this.width = nextW;
        this.height = nextH;
        if (changed && this.dom && this.liveLayout) {
          this.liveLayout.dispose();
          this.liveLayout = await enableLiveLayout(this.dom, await getDefaultModule(), {
            width: this.width,
            height: this.height,
            baseUrl: this.currentUrl === "about:blank" ? undefined : this.currentUrl,
          });
        }
        return {};
      }
      case "Emulation.clearDeviceMetricsOverride":
      case "Emulation.setFocusEmulationEnabled":
      case "Emulation.setDefaultBackgroundColorOverride":
      case "Emulation.setScriptExecutionDisabled":
      case "Emulation.setTouchEmulationEnabled":
      case "Network.enable":
      case "Network.disable":
      case "Network.setCacheDisabled":
      case "Network.setExtraHTTPHeaders":
      case "Network.setUserAgentOverride":
      case "Log.enable":
      case "Log.disable":
      case "Audits.enable":
      case "Performance.enable":
      case "WebMCP.enable":
      case "Target.setAutoAttach":
      case "Security.setIgnoreCertificateErrors":
      case "DOM.enable":
      case "DOM.disable":
      case "CSS.enable":
      case "CSS.disable": {
        return {};
      }

      default: {
        this.onUnhandledMethod?.(method, params);
        return {};
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPump();
    this.ioStreams.clear();
    if (this.liveLayout) {
      try {
        this.liveLayout.dispose();
      } catch {
        // ignore dispose errors
      }
      this.liveLayout = undefined;
    }
    if (this.dom) {
      try {
        this.dom.close();
      } catch {
        // ignore close errors
      }
      this.dom = undefined;
      this.opened = undefined;
    }
  }

  private async ensureDom(): Promise<QuickJSDOM> {
    if (!this.dom) {
      await this.initBlank();
    }
    return this.dom!;
  }

  private async navigateTo(url: string): Promise<void> {
    if (this.closed) return;
    if (url === "about:blank") {
      await this.loadHtml("", "about:blank", true);
      return;
    }
    const { html, finalUrl } = await this.fetchPageHtml(url);
    if (!this.closed) {
      await this.loadHtml(html, finalUrl, true);
    }
  }

  private async fetchPageHtml(url: string): Promise<{ html: string; finalUrl: string }> {
    const cookie = this.cookieJar.getCookieStringSync(url, { httpOnly: true });
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const res = await fetch(url, { headers });
    const finalUrl = res.url || url;
    const setCookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      try {
        this.cookieJar.setCookieSync(sc, finalUrl);
      } catch {
        // ignore invalid cookie
      }
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const html = decodeHtml(buf, res.headers.get("content-type") ?? undefined);
    return { html, finalUrl };
  }

  private async loadHtml(html: string, url: string, emitNavEvents: boolean): Promise<void> {
    this.stopPump();

    if (this.liveLayout) {
      try {
        this.liveLayout.dispose();
      } catch {
        // ignore dispose errors
      }
      this.liveLayout = undefined;
    }
    if (this.dom) {
      if (this.runtimeEnabled) {
        if (this.currentContextId > 0) {
          this.emit("Runtime.executionContextDestroyed", { executionContextId: this.currentContextId });
        }
        for (const id of this.extraContextIds) {
          this.emit("Runtime.executionContextDestroyed", { executionContextId: id });
        }
        this.emit("Runtime.executionContextsCleared", {});
      }
      this.dom.close();
      this.dom = undefined;
      this.opened = undefined;
    }

    this.extraContextIds = [];
    this.currentUrl = url;
    const loaderId = `${this.loaderIdPrefix}${++this.loaderSeq}`;

    if (emitNavEvents && this.pageEnabled) {
      this.emit("Page.frameStartedLoading", { frameId: this.frameId });
    }

    const wasm = (this.quickjsWasm ??= await getDefaultQuickJSWasm());
    const mainScripts = Array.from(this.extraScripts.values())
      .filter((s) => !s.worldName)
      .map((s) => s.source);
    const beforeScripts = [GUEST_CDP_RUNTIME_SCRIPT, ...mainScripts];

    const opened = openPage(html, url, wasm, {
      width: this.width,
      height: this.height,
      cookieJar: this.cookieJar,
      limits: this.limits,
      beforeScripts,
      settleMs: 0,
    });
    opened.onActivity = () => this.schedulePump();

    this.opened = opened;
    this.dom = opened.dom;

    opened.dom.expose("__cdp_navigate", (nextUrl: unknown) => {
      const targetUrl = String(nextUrl ?? "");
      if (!targetUrl || this.closed) return;
      setTimeout(() => {
        if (!this.closed) {
          this.navQueue = this.navQueue.then(() => this.navigateTo(targetUrl)).catch(() => {});
        }
      }, 0);
    });
    opened.dom.expose("__cdp_reload", () => {
      if (this.closed) return;
      const targetUrl = this.currentUrl;
      setTimeout(() => {
        if (!this.closed) {
          this.navQueue = this.navQueue.then(() => this.navigateTo(targetUrl)).catch(() => {});
        }
      }, 0);
    });

    if (emitNavEvents && this.pageEnabled) {
      this.emit("Page.frameNavigated", {
        frame: {
          id: this.frameId,
          loaderId,
          url: this.currentUrl,
          domainAndRegistry: "",
          securityOrigin: this.originOf(this.currentUrl),
          mimeType: "text/html",
        },
      });
    }

    this.currentContextId = this.contextSeq++;
    if (this.runtimeEnabled) {
      this.emitExecutionContextCreated(this.currentContextId, "", true);
      for (const worldName of this.isolatedWorldNames) {
        const isoId = this.contextSeq++;
        this.extraContextIds.push(isoId);
        this.emitExecutionContextCreated(isoId, worldName, false);
      }
    }

    await opened.start({ settle: false });

    this.liveLayout = await enableLiveLayout(opened.dom, await getDefaultModule(), {
      width: this.width,
      height: this.height,
      baseUrl: this.currentUrl === "about:blank" ? undefined : this.currentUrl,
    });

    if (emitNavEvents && this.pageEnabled) {
      if (this.lifecycleEventsEnabled) {
        const ts = Date.now() / 1000;
        for (const name of ["init", "DOMContentLoaded", "load", "networkAlmostIdle", "networkIdle"]) {
          this.emit("Page.lifecycleEvent", {
            frameId: this.frameId,
            loaderId,
            name,
            timestamp: ts,
          });
        }
      }
      this.emit("Page.loadEventFired", { timestamp: Date.now() / 1000 });
      this.emit("Page.domContentEventFired", { timestamp: Date.now() / 1000 });
      this.emit("Page.frameStoppedLoading", { frameId: this.frameId });
    }

    this.schedulePump();
  }

  private emitExecutionContextCreated(id: number, name: string, isDefault: boolean): void {
    this.emit("Runtime.executionContextCreated", {
      context: {
        id,
        origin: this.originOf(this.currentUrl),
        name,
        auxData: {
          isDefault,
          type: isDefault ? "default" : "isolated",
          frameId: this.frameId,
        },
      },
    });
  }

  private originOf(url: string): string {
    try {
      const u = new URL(url);
      return u.origin === "null" ? "" : u.origin;
    } catch {
      return "";
    }
  }

  private schedulePump(): void {
    if (this.closed || !this.opened || this.pumping) return;
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    const wake = this.opened.nextWake();
    if (wake < 0) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined;
      void this.runPump();
    }, Math.max(0, wake));
  }

  private async runPump(): Promise<void> {
    if (this.closed || !this.opened || this.pumping) return;
    this.pumping = true;
    try {
      await this.opened.step();
    } catch {
      // page timer/script error shouldn't crash the CDP transport
    } finally {
      this.pumping = false;
      this.schedulePump();
    }
  }

  private stopPump(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
  }

  private emit(method: string, params: Record<string, unknown>): void {
    this.emitEvent(method, params, this.sessionId);
  }
}
