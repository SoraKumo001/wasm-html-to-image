import type { QuickJSDOM } from "wasm-quickjs-dom";
import {
  Canvas,
  CanvasGradient,
  CanvasImageData,
  CanvasPath2D,
  CanvasRenderingContext2D,
} from "./canvas.js";
import { loadHtmlToImageModule, type HtmlToImageModule } from "./loader.js";

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    );
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildPath2D(cmds: unknown[][]): CanvasPath2D {
  const path = new CanvasPath2D();
  for (const c of cmds) {
    const op = c[0] as string;
    if (op === "svg") {
      path.addPath(new CanvasPath2D(String(c[1] ?? "")));
    } else {
      const fn = (path as unknown as Record<string, (...a: unknown[]) => void>)[
        op
      ];
      if (typeof fn === "function") fn.apply(path, c.slice(1));
    }
  }
  return path;
}

const GUEST_CANVAS_SCRIPT = `(function () {
  var g = globalThis;
  if (typeof g.__edgeSetCanvasAdapter !== "function") return;
  var nextId = 1;
  var ctxMap = new WeakMap();
  var activeCanvases = [];

  function callHost(payload) {
    return g.__canvasProvider(JSON.stringify(payload));
  }

  function flushCtx(ctx) {
    if (!ctx || ctx._ops.length === 0) return;
    var ops = ctx._ops;
    ctx._ops = [];
    callHost({ t: "batch", id: ctx._id, ops: ops });
  }

  function encodeStyle(v) {
    if (v && typeof v === "object" && v.__grad) {
      return { __grad: v.__grad, params: v._params, stops: v._stops };
    }
    return String(v);
  }

  function b64FromBytes(u8) {
    var bin = "";
    for (var i = 0; i < u8.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function bytesFromB64(b64) {
    var bin = atob(b64);
    var out = new Uint8ClampedArray(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function makeGradient(kind, params) {
    return {
      __grad: kind,
      _params: params,
      _stops: [],
      addColorStop: function (offset, color) {
        this._stops.push([offset, String(color)]);
      }
    };
  }

  function makeCtx(canvas, id) {
    var state = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10,
      lineDash: [],
      lineDashOffset: 0,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      filter: "none",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "medium"
    };
    var stack = [];
    var ctx = {
      canvas: canvas,
      _id: id,
      _ops: [],
      _push: function (op) {
        this._ops.push(op);
        if (this._ops.length >= 512) flushCtx(this);
      },
      save: function () {
        var copy = Object.assign({}, state);
        copy.lineDash = state.lineDash.slice();
        stack.push(copy);
        this._push(["save"]);
      },
      restore: function () {
        var prev = stack.pop();
        if (prev) state = prev;
        this._push(["restore"]);
      },
      setLineDash: function (segs) {
        state.lineDash = Array.isArray(segs) ? segs.slice() : [];
        this._push(["setLineDash", state.lineDash]);
      },
      getLineDash: function () {
        return state.lineDash.slice();
      },
      createLinearGradient: function (x0, y0, x1, y1) {
        return makeGradient("linear", [x0, y0, x1, y1]);
      },
      createRadialGradient: function (x0, y0, r0, x1, y1, r1) {
        return makeGradient("radial", [x0, y0, r0, x1, y1, r1]);
      },
      createConicGradient: function (sa, x, y) {
        return makeGradient("conic", [sa, x, y]);
      },
      fill: function (a, b) {
        if (typeof state.fillStyle === "object" && state.fillStyle && state.fillStyle.__grad) {
          this._push(["prop", "fillStyle", encodeStyle(state.fillStyle)]);
        }
        if (a && typeof a === "object" && Array.isArray(a._cmds)) {
          this._push(["fillPath", a._cmds, b || "nonzero"]);
        } else {
          this._push(["fill", a || "nonzero"]);
        }
      },
      stroke: function (a) {
        if (typeof state.strokeStyle === "object" && state.strokeStyle && state.strokeStyle.__grad) {
          this._push(["prop", "strokeStyle", encodeStyle(state.strokeStyle)]);
        }
        if (a && typeof a === "object" && Array.isArray(a._cmds)) {
          this._push(["strokePath", a._cmds]);
        } else {
          this._push(["stroke"]);
        }
      },
      clip: function (a, b) {
        if (a && typeof a === "object" && Array.isArray(a._cmds)) {
          this._push(["clipPath", a._cmds, b || "nonzero"]);
        } else {
          this._push(["clip", a || "nonzero"]);
        }
      },
      fillRect: function (x, y, w, h) {
        if (typeof state.fillStyle === "object" && state.fillStyle && state.fillStyle.__grad) {
          this._push(["prop", "fillStyle", encodeStyle(state.fillStyle)]);
        }
        this._push(["fillRect", x, y, w, h]);
      },
      strokeRect: function (x, y, w, h) {
        if (typeof state.strokeStyle === "object" && state.strokeStyle && state.strokeStyle.__grad) {
          this._push(["prop", "strokeStyle", encodeStyle(state.strokeStyle)]);
        }
        this._push(["strokeRect", x, y, w, h]);
      },
      drawImage: function (img) {
        var rest = Array.prototype.slice.call(arguments, 1);
        if (img && img.__cid) {
          var srcCtx = ctxMap.get(img);
          if (srcCtx) flushCtx(srcCtx);
          flushCtx(this);
          this._push(["drawImage", img.__cid].concat(rest));
          flushCtx(this);
        }
      },
      createImageData: function (a, b) {
        if (typeof a === "number") return new g.ImageData(a, b);
        return new g.ImageData(a.width, a.height);
      },
      getImageData: function (sx, sy, sw, sh) {
        flushCtx(this);
        var b64 = callHost({ t: "getImageData", id: this._id, sx: sx, sy: sy, sw: sw, sh: sh });
        var data = b64 ? bytesFromB64(b64) : new Uint8ClampedArray(sw * sh * 4);
        return new g.ImageData(data, sw, sh);
      },
      putImageData: function (imgData, dx, dy) {
        if (!imgData || !imgData.data) return;
        this._push(["putImageData", b64FromBytes(imgData.data), dx, dy, imgData.width, imgData.height]);
      }
    };

    [
      "translate", "scale", "rotate", "transform", "setTransform", "resetTransform",
      "clearRect", "beginPath", "closePath", "moveTo", "lineTo",
      "quadraticCurveTo", "bezierCurveTo", "arc", "arcTo", "ellipse", "rect", "roundRect"
    ].forEach(function (m) {
      ctx[m] = function () {
        this._push([m].concat(Array.prototype.slice.call(arguments)));
      };
    });

    ["fillStyle", "strokeStyle"].forEach(function (k) {
      Object.defineProperty(ctx, k, {
        get: function () { return state[k]; },
        set: function (v) {
          state[k] = v;
          this._push(["prop", k, encodeStyle(v)]);
        }
      });
    });

    [
      "lineWidth", "lineCap", "lineJoin", "miterLimit", "lineDashOffset",
      "globalAlpha", "globalCompositeOperation", "shadowColor", "shadowBlur",
      "shadowOffsetX", "shadowOffsetY", "filter", "imageSmoothingEnabled", "imageSmoothingQuality"
    ].forEach(function (k) {
      Object.defineProperty(ctx, k, {
        get: function () { return state[k]; },
        set: function (v) {
          state[k] = v;
          this._push(["prop", k, v]);
        }
      });
    });

    return ctx;
  }

  function ensureCanvasCtx(canvas) {
    var existing = ctxMap.get(canvas);
    if (existing) return existing;
    var id = nextId++;
    canvas.__cid = id;
    var w = canvas.width > 0 ? canvas.width : 300;
    var h = canvas.height > 0 ? canvas.height : 150;
    callHost({ t: "create", id: id, w: w, h: h });
    var ctx = makeCtx(canvas, id);
    ctxMap.set(canvas, ctx);
    activeCanvases.push(canvas);
    return ctx;
  }

  g.__registerHostCanvas = function (canvas) {
    return ensureCanvasCtx(canvas)._id;
  };

  g.__flushGuestCanvas = function (id) {
    for (var i = 0; i < activeCanvases.length; i++) {
      var c = activeCanvases[i];
      var ctx = c && ctxMap.get(c);
      if (ctx && ctx._id === id) {
        flushCtx(ctx);
        return;
      }
    }
  };

  g.__edgeSetCanvasAdapter({
    getContext: function (canvas, type) {
      if (type !== "2d") return null;
      return ensureCanvasCtx(canvas);
    },
    resize: function (canvas, w, h) {
      var ctx = ctxMap.get(canvas);
      if (!ctx) return;
      ctx._ops.length = 0;
      callHost({ t: "resize", id: ctx._id, w: w > 0 ? w : 300, h: h > 0 ? h : 150 });
    },
    toDataURL: function (canvas, type, quality) {
      var ctx = ctxMap.get(canvas);
      if (!ctx) return undefined;
      flushCtx(ctx);
      return callHost({ t: "toDataURL", id: ctx._id, type: type || "image/png", quality: quality });
    },
    toBlob: function (canvas, cb, type, quality) {
      var url = this.toDataURL(canvas, type, quality);
      if (!url) return undefined;
      var comma = url.indexOf(",");
      var b64 = comma >= 0 ? url.slice(comma + 1) : "";
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var blob = new g.Blob([bytes], { type: type || "image/png" });
      if (typeof cb === "function") g.setTimeout(function () { cb(blob); }, 0);
      return undefined;
    },
    convertToBlob: function (canvas, options) {
      var type = (options && options.type) || "image/png";
      var quality = options && options.quality;
      var url = this.toDataURL(canvas, type, quality);
      if (!url) return undefined;
      var comma = url.indexOf(",");
      var b64 = comma >= 0 ? url.slice(comma + 1) : "";
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(new g.Blob([bytes], { type: type }));
    },
    prepareSerialize: function (doc) {
      for (var i = 0; i < activeCanvases.length; i++) {
        var c = activeCanvases[i];
        if (!c || !doc.contains(c)) continue;
        var url = this.toDataURL(c, "image/png");
        if (!url) continue;
        if (!c.style.display) c.style.display = "inline-block";
        if (!c.style.width) c.style.width = (c.width || 300) + "px";
        if (!c.style.height) c.style.height = (c.height || 150) + "px";
        c.style.backgroundImage = "url(" + url + ")";
        c.style.backgroundSize = "100% 100%";
        c.style.backgroundRepeat = "no-repeat";
      }
    }
  });
})();`;

export interface CanvasBridge {
  dispose(): void;
}

/**
 * Target environment on which to install the 2D Canvas bridge:
 * - A `QuickJSDOM` instance returned by `createDOM()`
 * - A `JSDOM` instance returned by `new JSDOM()` (`wasm-quickjs-dom/jsdom`)
 * - A `window` or `globalThis` object inside a `wasm-quickjs-dom` Vitest/Jest environment
 */
export type CanvasBridgeTarget =
  | QuickJSDOM
  | { readonly window: unknown }
  | Record<string, unknown>;

/**
 * Install a synchronous 2D Canvas bridge backed by Skia Wasm on a `QuickJSDOM` page, a `JSDOM`
 * instance, or a Vitest/Jest `window` (`globalThis`).
 *
 * Works seamlessly from both:
 * 1. Guest `<script>` tags running inside QuickJS (`createDOM` / `render({ javascript: { canvas: true } })`)
 * 2. Host JavaScript/React components running in Node.js / Vitest (`environment: "wasm-quickjs-dom"`)
 */
export async function installCanvasBridge(
  target: CanvasBridgeTarget = globalThis as unknown as Record<string, unknown>,
  module?: HtmlToImageModule,
): Promise<CanvasBridge> {
  const mod = module ?? (await loadHtmlToImageModule());
  const canvases = new Map<
    number,
    { canvas: Canvas; ctx: CanvasRenderingContext2D }
  >();
  const offscreenCanvases: Canvas[] = [];
  const hostElementIds = new WeakMap<object, number>();
  let disposed = false;

  const isQuickJSDOM =
    target !== null &&
    typeof target === "object" &&
    typeof (target as QuickJSDOM).bridge === "function" &&
    typeof (target as QuickJSDOM).eval === "function";

  let bridgeWin: Record<string, unknown>;
  let hostScope: Record<string, unknown> | null = null;

  if (isQuickJSDOM) {
    bridgeWin = (target as QuickJSDOM).bridge().window as unknown as Record<
      string,
      unknown
    >;
  } else {
    const obj = target as Record<string, unknown>;
    const doc = obj.document as { defaultView?: Record<string, unknown> } | undefined;
    if (doc && doc.defaultView && typeof doc.defaultView === "object") {
      bridgeWin = doc.defaultView;
      if (obj !== bridgeWin) hostScope = obj;
    } else if (
      obj.window &&
      typeof obj.window === "object" &&
      obj.window !== obj
    ) {
      const winObj = obj.window as Record<string, unknown>;
      const winDoc = winObj.document as
        | { defaultView?: Record<string, unknown> }
        | undefined;
      bridgeWin = winDoc?.defaultView ?? winObj;
      if (winObj !== bridgeWin) hostScope = winObj;
    } else {
      bridgeWin = obj;
    }
  }

  const resolveStyle = (
    ctx: CanvasRenderingContext2D,
    val: unknown,
  ): string | CanvasGradient => {
    if (
      val &&
      typeof val === "object" &&
      "__grad" in val &&
      "params" in val &&
      Array.isArray(val.params)
    ) {
      const g = val as unknown as {
        __grad: "linear" | "radial" | "conic";
        params: number[];
        stops: [number, string][];
      };
      const grad =
        g.__grad === "linear"
          ? ctx.createLinearGradient(
              g.params[0],
              g.params[1],
              g.params[2],
              g.params[3],
            )
          : g.__grad === "radial"
            ? ctx.createRadialGradient(
                g.params[0],
                g.params[1],
                g.params[2],
                g.params[3],
                g.params[4],
                g.params[5],
              )
            : ctx.createConicGradient(g.params[0], g.params[1], g.params[2]);
      for (const [offset, color] of g.stops) {
        grad.addColorStop(offset, color);
      }
      return grad;
    }
    return String(val);
  };

  const provider = (reqJson: string): string => {
    if (disposed) throw new Error("Canvas bridge has been disposed.");
    const req = JSON.parse(reqJson) as Record<string, unknown>;
    const t = req.t as string;
    const id = req.id as number;

    if (t === "create") {
      const canvas = new Canvas(mod, Number(req.w) || 300, Number(req.h) || 150);
      const ctx = canvas.getContext("2d");
      canvases.set(id, { canvas, ctx });
      return "";
    }

    const entry = canvases.get(id);
    if (!entry) return "";

    if (t === "resize") {
      entry.canvas.width = Number(req.w) || 300;
      entry.canvas.height = Number(req.h) || 150;
      return "";
    }

    if (t === "batch") {
      const ops = req.ops as unknown[][];
      const ctx = entry.ctx;
      for (const op of ops) {
        const name = op[0] as string;
        if (name === "prop") {
          const prop = op[1] as string;
          const val = op[2];
          if (prop === "fillStyle" || prop === "strokeStyle") {
            ctx[prop] = resolveStyle(ctx, val);
          } else {
            (ctx as unknown as Record<string, unknown>)[prop] = val;
          }
        } else if (name === "fillPath") {
          const p = buildPath2D(op[1] as unknown[][]);
          ctx.fill(p, (op[2] as "nonzero" | "evenodd") ?? "nonzero");
        } else if (name === "strokePath") {
          const p = buildPath2D(op[1] as unknown[][]);
          ctx.stroke(p);
        } else if (name === "clipPath") {
          const p = buildPath2D(op[1] as unknown[][]);
          ctx.clip(p, (op[2] as "nonzero" | "evenodd") ?? "nonzero");
        } else if (name === "drawImage") {
          const srcEntry = canvases.get(op[1] as number);
          if (srcEntry) {
            (ctx.drawImage as (...a: unknown[]) => void)(
              srcEntry.canvas,
              ...op.slice(2),
            );
          }
        } else if (name === "putImageData") {
          const bytes = base64ToUint8(String(op[1]));
          const w = Number(op[4]);
          const h = Number(op[5]);
          ctx.putImageData(
            new CanvasImageData(
              new Uint8ClampedArray(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              ),
              w,
              h,
            ),
            Number(op[2]),
            Number(op[3]),
          );
        } else {
          const fn = (ctx as unknown as Record<string, (...a: unknown[]) => void>)[
            name
          ];
          if (typeof fn === "function") fn.apply(ctx, op.slice(1));
        }
      }
      return "";
    }

    if (t === "toDataURL") {
      return entry.canvas.toDataURL(
        (req.type as string) || "image/png",
        req.quality as number | undefined,
      );
    }

    if (t === "getImageData") {
      const img = entry.ctx.getImageData(
        Number(req.sx),
        Number(req.sy),
        Number(req.sw),
        Number(req.sh),
      );
      return uint8ToBase64(
        new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      );
    }

    return "";
  };

  bridgeWin.__canvasProvider = provider;

  const restoreCallbacks: Array<() => void> = [];

  const installHostHooks = () => {
    const ensureHostEntry = (el: object): { id: number; canvas: Canvas; ctx: CanvasRenderingContext2D } | null => {
      let id = hostElementIds.get(el);
      if (id === undefined) {
        const reg = bridgeWin.__registerHostCanvas;
        if (typeof reg !== "function") return null;
        id = Number(reg(el));
        hostElementIds.set(el, id);
      }
      const entry = canvases.get(id);
      if (!entry) return null;
      (entry.ctx as unknown as { canvas: unknown }).canvas = el;
      return { id, ...entry };
    };

    const flushGuest = (id: number) => {
      const flush = bridgeWin.__flushGuestCanvas;
      if (typeof flush === "function") flush(id);
    };

    const HTMLCanvasEl = bridgeWin.HTMLCanvasElement as
      | { prototype?: Record<string, unknown> }
      | undefined;
    const proto = HTMLCanvasEl?.prototype;
    if (proto) {
      const origGetContext = Object.getOwnPropertyDescriptor(proto, "getContext");
      const origToDataURL = Object.getOwnPropertyDescriptor(proto, "toDataURL");
      const origToBlob = Object.getOwnPropertyDescriptor(proto, "toBlob");
      const origBacking = Object.getOwnPropertyDescriptor(proto, "_backingCanvas");

      Object.defineProperty(proto, "_backingCanvas", {
        configurable: true,
        get(this: object) {
          const entry = ensureHostEntry(this);
          if (!entry) return undefined;
          flushGuest(entry.id);
          return entry.canvas;
        },
      });

      Object.defineProperty(proto, "getContext", {
        configurable: true,
        writable: true,
        enumerable: true,
        value: function (this: object, contextId: string) {
          if (contextId !== "2d") return null;
          const entry = ensureHostEntry(this);
          if (!entry) return null;
          flushGuest(entry.id);
          return entry.ctx;
        },
      });

      Object.defineProperty(proto, "toDataURL", {
        configurable: true,
        writable: true,
        enumerable: true,
        value: function (this: object, type = "image/png", quality?: number) {
          const entry = ensureHostEntry(this);
          if (!entry) return "data:,";
          flushGuest(entry.id);
          return entry.canvas.toDataURL(type, quality);
        },
      });

      Object.defineProperty(proto, "toBlob", {
        configurable: true,
        writable: true,
        enumerable: true,
        value: function (
          this: object,
          callback: (blob: Blob | null) => void,
          type = "image/png",
          quality?: number,
        ) {
          if (typeof callback !== "function") return;
          const entry = ensureHostEntry(this);
          if (!entry) {
            setTimeout(() => callback(null), 0);
            return;
          }
          flushGuest(entry.id);
          const url = entry.canvas.toDataURL(type, quality);
          const comma = url.indexOf(",");
          const mimeMatch = /^data:([^;,]+)/.exec(url);
          const outMime = mimeMatch ? mimeMatch[1] : "image/png";
          const bytes = base64ToUint8(comma >= 0 ? url.slice(comma + 1) : "");
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const blob = new Blob([ab], { type: outMime });
          setTimeout(() => callback(blob), 0);
        },
      });

      restoreCallbacks.push(() => {
        if (origGetContext) Object.defineProperty(proto, "getContext", origGetContext);
        if (origToDataURL) Object.defineProperty(proto, "toDataURL", origToDataURL);
        if (origToBlob) Object.defineProperty(proto, "toBlob", origToBlob);
        if (origBacking) Object.defineProperty(proto, "_backingCanvas", origBacking);
        else delete proto._backingCanvas;
      });
    }

    class HostOffscreenCanvas {
      readonly _backingCanvas: Canvas;
      constructor(width = 300, height = 150) {
        const c = new Canvas(
          mod,
          width > 0 ? width : 300,
          height > 0 ? height : 150,
        );
        offscreenCanvases.push(c);
        this._backingCanvas = c;
      }
      get width(): number {
        return this._backingCanvas.width;
      }
      set width(w: number) {
        this._backingCanvas.width = w > 0 ? w : 300;
      }
      get height(): number {
        return this._backingCanvas.height;
      }
      set height(h: number) {
        this._backingCanvas.height = h > 0 ? h : 150;
      }
      getContext(contextId: "2d"): CanvasRenderingContext2D;
      getContext(contextId: string): CanvasRenderingContext2D | null;
      getContext(contextId: string): CanvasRenderingContext2D | null {
        const ctx = this._backingCanvas.getContext(contextId);
        if (ctx) (ctx as unknown as { canvas: unknown }).canvas = this;
        return ctx;
      }
      toDataURL(type = "image/png", quality?: number): string {
        return this._backingCanvas.toDataURL(type, quality);
      }
      async convertToBlob(options?: {
        type?: string;
        quality?: number;
      }): Promise<Blob> {
        const type = options?.type ?? "image/png";
        const url = this._backingCanvas.toDataURL(type, options?.quality);
        const comma = url.indexOf(",");
        const mimeMatch = /^data:([^;,]+)/.exec(url);
        const outMime = mimeMatch ? mimeMatch[1] : "image/png";
        const bytes = base64ToUint8(comma >= 0 ? url.slice(comma + 1) : "");
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        return new Blob([ab], { type: outMime });
      }
    }

    const globalsToDefine: Record<string, unknown> = {
      ImageData: CanvasImageData,
      Path2D: CanvasPath2D,
      OffscreenCanvas: HostOffscreenCanvas,
      CanvasRenderingContext2D,
      CanvasGradient,
    };

    const scopes = hostScope ? [hostScope] : [];
    for (const scope of scopes) {
      for (const [k, v] of Object.entries(globalsToDefine)) {
        const prev = Object.getOwnPropertyDescriptor(scope, k);
        Object.defineProperty(scope, k, {
          configurable: true,
          writable: true,
          enumerable: false,
          value: v,
        });
        restoreCallbacks.push(() => {
          if (prev) Object.defineProperty(scope, k, prev);
          else delete scope[k];
        });
      }
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const fn of restoreCallbacks.reverse()) {
      try {
        fn();
      } catch {
        // ignore restore errors after window teardown
      }
    }
    restoreCallbacks.length = 0;
    for (const entry of canvases.values()) {
      entry.canvas.dispose();
    }
    canvases.clear();
    for (const c of offscreenCanvases) {
      c.dispose();
    }
    offscreenCanvases.length = 0;
  };

  try {
    if (isQuickJSDOM) {
      await (target as QuickJSDOM).eval(GUEST_CANVAS_SCRIPT);
    } else if (typeof bridgeWin.eval === "function") {
      (bridgeWin.eval as (code: string) => unknown)(GUEST_CANVAS_SCRIPT);
    } else {
      throw new Error(
        "installCanvasBridge: target does not appear to be a QuickJSDOM, JSDOM, or wasm-quickjs-dom Window.",
      );
    }
    installHostHooks();
  } catch (err) {
    dispose();
    throw err;
  }

  return { dispose };
}
