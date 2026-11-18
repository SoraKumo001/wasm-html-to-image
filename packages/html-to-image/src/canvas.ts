import { FORMAT_INT } from "./encode-args.js";
import type { OutputFormat } from "./core.js";
import type { HtmlToImageModule, WasmInstancePtr } from "./loader.js";

const enum Op {
  Save = 1,
  Restore = 2,
  Translate = 3,
  Scale = 4,
  Rotate = 5,
  Transform = 6,
  SetTransform = 7,
  ResetTransform = 8,
  ClipRect = 9,
  ClipPath = 10,
  FillRect = 11,
  StrokeRect = 12,
  ClearRect = 13,
  BeginPath = 14,
  ClosePath = 15,
  MoveTo = 16,
  LineTo = 17,
  QuadraticCurveTo = 18,
  BezierCurveTo = 19,
  Arc = 20,
  ArcTo = 21,
  Ellipse = 22,
  Rect = 23,
  RoundRect = 24,
  Fill = 25,
  Stroke = 26,
  SetFillColor = 27,
  SetStrokeColor = 28,
  SetFillLinearGradient = 29,
  SetStrokeLinearGradient = 30,
  SetFillRadialGradient = 31,
  SetStrokeRadialGradient = 32,
  SetFillConicGradient = 33,
  SetStrokeConicGradient = 34,
  SetLineWidth = 35,
  SetLineCap = 36,
  SetLineJoin = 37,
  SetMiterLimit = 38,
  SetLineDash = 39,
  SetLineDashOffset = 40,
  SetGlobalAlpha = 41,
  SetBlendMode = 42,
  SetShadow = 43,
  SetFilter = 44,
  SetImageSmoothing = 45,
  AddSvgPath = 46,
}

export type CanvasLineCap = "butt" | "round" | "square";
export type CanvasLineJoin = "miter" | "round" | "bevel";
export type CanvasFillRule = "nonzero" | "evenodd";
export type ImageSmoothingQuality = "low" | "medium" | "high";
export type GlobalCompositeOperation =
  | "source-over"
  | "source-in"
  | "source-out"
  | "source-atop"
  | "destination-over"
  | "destination-in"
  | "destination-out"
  | "destination-atop"
  | "lighter"
  | "copy"
  | "xor"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface CanvasImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace: "srgb";
}

export class CanvasGradient {
  /** @internal */
  readonly _kind: "linear" | "radial" | "conic";
  /** @internal */
  readonly _params: number[];
  /** @internal */
  readonly _stops: Array<{ offset: number; color: string }> = [];

  /** @internal */
  constructor(kind: "linear" | "radial" | "conic", params: number[]) {
    this._kind = kind;
    this._params = params;
  }

  addColorStop(offset: number, color: string): void {
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
      throw new RangeError(
        `CanvasGradient.addColorStop: offset must be between 0 and 1, got ${offset}`,
      );
    }
    this._stops.push({ offset, color: String(color) });
  }
}

interface PathCmd {
  op: Op;
  args?: number[];
  str?: string;
}

export class CanvasPath2D {
  /** @internal */
  readonly _cmds: PathCmd[] = [];

  constructor(path?: string | CanvasPath2D) {
    if (typeof path === "string") {
      this._cmds.push({ op: Op.AddSvgPath, str: path });
    } else if (path instanceof CanvasPath2D) {
      this._cmds.push(...path._cmds);
    }
  }

  addPath(path: CanvasPath2D): void {
    this._cmds.push(...path._cmds);
  }
  closePath(): void {
    this._cmds.push({ op: Op.ClosePath });
  }
  moveTo(x: number, y: number): void {
    this._cmds.push({ op: Op.MoveTo, args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this._cmds.push({ op: Op.LineTo, args: [x, y] });
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this._cmds.push({ op: Op.QuadraticCurveTo, args: [cpx, cpy, x, y] });
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this._cmds.push({
      op: Op.BezierCurveTo,
      args: [cp1x, cp1y, cp2x, cp2y, x, y],
    });
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this._cmds.push({
      op: Op.Arc,
      args: [x, y, radius, startAngle, endAngle, counterclockwise ? 1 : 0],
    });
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this._cmds.push({ op: Op.ArcTo, args: [x1, y1, x2, y2, radius] });
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this._cmds.push({
      op: Op.Ellipse,
      args: [
        x,
        y,
        radiusX,
        radiusY,
        rotation,
        startAngle,
        endAngle,
        counterclockwise ? 1 : 0,
      ],
    });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this._cmds.push({ op: Op.Rect, args: [x, y, w, h] });
  }
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | number[] = 0,
  ): void {
    this._cmds.push({
      op: Op.RoundRect,
      args: [x, y, w, h, ...normalizeRadii(radii)],
    });
  }
}

function normalizeRadii(radii: number | number[]): number[] {
  const arr = typeof radii === "number" ? [radii] : radii;
  if (arr.length === 0) return [0, 0, 0, 0, 0, 0, 0, 0];
  if (arr.length === 1) {
    const r = Math.max(0, arr[0]);
    return [r, r, r, r, r, r, r, r];
  }
  if (arr.length === 2) {
    const a = Math.max(0, arr[0]);
    const b = Math.max(0, arr[1]);
    return [a, a, b, b, a, a, b, b];
  }
  if (arr.length === 3) {
    const a = Math.max(0, arr[0]);
    const b = Math.max(0, arr[1]);
    const c = Math.max(0, arr[2]);
    return [a, a, b, b, c, c, b, b];
  }
  const tl = Math.max(0, arr[0]);
  const tr = Math.max(0, arr[1]);
  const br = Math.max(0, arr[2]);
  const bl = Math.max(0, arr[3]);
  return [tl, tl, tr, tr, br, br, bl, bl];
}

interface StateSnapshot {
  fillStyle: string | CanvasGradient;
  strokeStyle: string | CanvasGradient;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  lineDash: number[];
  lineDashOffset: number;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  filter: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
}

const DEFAULT_STATE: StateSnapshot = {
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
  imageSmoothingQuality: "medium",
};

export type CanvasImageSource =
  | Uint8Array
  | ArrayBuffer
  | Canvas
  | { converterInst: WasmInstancePtr; frameIndex?: number };

export interface CanvasEncodeOptions {
  format?: OutputFormat;
  quality?: number;
  speed?: number;
}

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

const BATCH_FLUSH_THRESHOLD = 4096;

export class CanvasRenderingContext2D {
  readonly canvas: Canvas;
  private readonly mod: HtmlToImageModule;
  private readonly inst: WasmInstancePtr;
  private ops: number[] = [];
  private args: number[] = [];
  private strings: string[] = [];
  private state: StateSnapshot = { ...DEFAULT_STATE, lineDash: [] };
  private stack: StateSnapshot[] = [];

  /** @internal */
  constructor(canvas: Canvas, mod: HtmlToImageModule, inst: WasmInstancePtr) {
    this.canvas = canvas;
    this.mod = mod;
    this.inst = inst;
  }

  /** @internal */
  _resetState(): void {
    this.ops.length = 0;
    this.args.length = 0;
    this.strings.length = 0;
    this.state = { ...DEFAULT_STATE, lineDash: [] };
    this.stack.length = 0;
  }

  /** @internal */
  _flush(): void {
    if (this.ops.length === 0) return;
    const opsU8 = new Uint8Array(this.ops);
    const argsF64 = new Float64Array(this.args);
    const strs = this.strings;
    this.ops = [];
    this.args = [];
    this.strings = [];
    this.mod.canvas_exec_batch!(this.inst, opsU8, argsF64, strs);
  }

  private push(op: Op, numArgs?: number[], strArgs?: string[]): void {
    this.ops.push(op);
    if (numArgs) {
      for (let i = 0; i < numArgs.length; i++) this.args.push(numArgs[i]);
    }
    if (strArgs) {
      for (let i = 0; i < strArgs.length; i++) this.strings.push(strArgs[i]);
    }
    if (this.ops.length >= BATCH_FLUSH_THRESHOLD) {
      this._flush();
    }
  }

  private pushGradient(isStroke: boolean, g: CanvasGradient): void {
    const stops = g._stops;
    if (stops.length === 0) return;
    const numArgs = [...g._params, stops.length];
    const strArgs: string[] = [];
    for (const s of stops) {
      numArgs.push(s.offset);
      strArgs.push(s.color);
    }
    const op =
      g._kind === "linear"
        ? isStroke
          ? Op.SetStrokeLinearGradient
          : Op.SetFillLinearGradient
        : g._kind === "radial"
          ? isStroke
            ? Op.SetStrokeRadialGradient
            : Op.SetFillRadialGradient
          : isStroke
            ? Op.SetStrokeConicGradient
            : Op.SetFillConicGradient;
    this.push(op, numArgs, strArgs);
  }

  // --- Style & state properties ---
  get fillStyle(): string | CanvasGradient {
    return this.state.fillStyle;
  }
  set fillStyle(v: string | CanvasGradient) {
    this.state.fillStyle = v;
    if (v instanceof CanvasGradient) {
      this.pushGradient(false, v);
    } else {
      this.push(Op.SetFillColor, undefined, [String(v)]);
    }
  }

  get strokeStyle(): string | CanvasGradient {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: string | CanvasGradient) {
    this.state.strokeStyle = v;
    if (v instanceof CanvasGradient) {
      this.pushGradient(true, v);
    } else {
      this.push(Op.SetStrokeColor, undefined, [String(v)]);
    }
  }

  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    if (Number.isFinite(v) && v > 0) {
      this.state.lineWidth = v;
      this.push(Op.SetLineWidth, [v]);
    }
  }

  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineCap(v: CanvasLineCap) {
    this.state.lineCap = v;
    this.push(Op.SetLineCap, [v === "round" ? 1 : v === "square" ? 2 : 0]);
  }

  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.state.lineJoin = v;
    this.push(Op.SetLineJoin, [v === "round" ? 1 : v === "bevel" ? 2 : 0]);
  }

  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(v: number) {
    if (Number.isFinite(v) && v > 0) {
      this.state.miterLimit = v;
      this.push(Op.SetMiterLimit, [v]);
    }
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(v: number) {
    if (Number.isFinite(v)) {
      this.state.lineDashOffset = v;
      this.push(Op.SetLineDashOffset, [v]);
    }
  }

  setLineDash(segments: number[]): void {
    const clean = segments.filter((n) => Number.isFinite(n) && n >= 0);
    const normalized = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
    this.state.lineDash = normalized;
    this.push(Op.SetLineDash, [normalized.length, ...normalized]);
  }
  getLineDash(): number[] {
    return [...this.state.lineDash];
  }

  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    if (Number.isFinite(v) && v >= 0 && v <= 1) {
      this.state.globalAlpha = v;
      this.push(Op.SetGlobalAlpha, [v]);
    }
  }

  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: GlobalCompositeOperation) {
    this.state.globalCompositeOperation = v;
    this.push(Op.SetBlendMode, undefined, [String(v)]);
  }

  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(v: string) {
    this.state.shadowColor = String(v);
    this.pushShadow();
  }
  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(v: number) {
    if (Number.isFinite(v) && v >= 0) {
      this.state.shadowBlur = v;
      this.pushShadow();
    }
  }
  get shadowOffsetX(): number {
    return this.state.shadowOffsetX;
  }
  set shadowOffsetX(v: number) {
    if (Number.isFinite(v)) {
      this.state.shadowOffsetX = v;
      this.pushShadow();
    }
  }
  get shadowOffsetY(): number {
    return this.state.shadowOffsetY;
  }
  set shadowOffsetY(v: number) {
    if (Number.isFinite(v)) {
      this.state.shadowOffsetY = v;
      this.pushShadow();
    }
  }
  private pushShadow(): void {
    this.push(
      Op.SetShadow,
      [
        this.state.shadowBlur,
        this.state.shadowOffsetX,
        this.state.shadowOffsetY,
      ],
      [this.state.shadowColor],
    );
  }

  get filter(): string {
    return this.state.filter;
  }
  set filter(v: string) {
    this.state.filter = String(v);
    this.push(Op.SetFilter, undefined, [this.state.filter]);
  }

  get imageSmoothingEnabled(): boolean {
    return this.state.imageSmoothingEnabled;
  }
  set imageSmoothingEnabled(v: boolean) {
    this.state.imageSmoothingEnabled = Boolean(v);
    this.pushSmoothing();
  }
  get imageSmoothingQuality(): ImageSmoothingQuality {
    return this.state.imageSmoothingQuality;
  }
  set imageSmoothingQuality(v: ImageSmoothingQuality) {
    this.state.imageSmoothingQuality = v;
    this.pushSmoothing();
  }
  private pushSmoothing(): void {
    const q =
      this.state.imageSmoothingQuality === "high"
        ? 2
        : this.state.imageSmoothingQuality === "medium"
          ? 1
          : 0;
    this.push(Op.SetImageSmoothing, [
      this.state.imageSmoothingEnabled ? 1 : 0,
      q,
    ]);
  }

  // --- State stack & transforms ---
  save(): void {
    this.stack.push({
      ...this.state,
      lineDash: [...this.state.lineDash],
    });
    this.push(Op.Save);
  }
  restore(): void {
    const prev = this.stack.pop();
    if (prev) this.state = prev;
    this.push(Op.Restore);
  }
  translate(x: number, y: number): void {
    this.push(Op.Translate, [x, y]);
  }
  scale(x: number, y: number): void {
    this.push(Op.Scale, [x, y]);
  }
  rotate(angle: number): void {
    this.push(Op.Rotate, [angle]);
  }
  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.push(Op.Transform, [a, b, c, d, e, f]);
  }
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.push(Op.SetTransform, [a, b, c, d, e, f]);
  }
  resetTransform(): void {
    this.push(Op.ResetTransform);
  }

  // --- Gradients ---
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): CanvasGradient {
    return new CanvasGradient("linear", [x0, y0, x1, y1]);
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient {
    return new CanvasGradient("radial", [x0, y0, r0, x1, y1, r1]);
  }
  createConicGradient(
    startAngle: number,
    x: number,
    y: number,
  ): CanvasGradient {
    return new CanvasGradient("conic", [startAngle, x, y]);
  }

  // --- Rectangles ---
  fillRect(x: number, y: number, w: number, h: number): void {
    if (this.state.fillStyle instanceof CanvasGradient) {
      this.pushGradient(false, this.state.fillStyle);
    }
    this.push(Op.FillRect, [x, y, w, h]);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    if (this.state.strokeStyle instanceof CanvasGradient) {
      this.pushGradient(true, this.state.strokeStyle);
    }
    this.push(Op.StrokeRect, [x, y, w, h]);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.push(Op.ClearRect, [x, y, w, h]);
  }

  // --- Paths ---
  beginPath(): void {
    this.push(Op.BeginPath);
  }
  closePath(): void {
    this.push(Op.ClosePath);
  }
  moveTo(x: number, y: number): void {
    this.push(Op.MoveTo, [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.push(Op.LineTo, [x, y]);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.push(Op.QuadraticCurveTo, [cpx, cpy, x, y]);
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.push(Op.BezierCurveTo, [cp1x, cp1y, cp2x, cp2y, x, y]);
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.push(Op.Arc, [
      x,
      y,
      radius,
      startAngle,
      endAngle,
      counterclockwise ? 1 : 0,
    ]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.push(Op.ArcTo, [x1, y1, x2, y2, radius]);
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.push(Op.Ellipse, [
      x,
      y,
      radiusX,
      radiusY,
      rotation,
      startAngle,
      endAngle,
      counterclockwise ? 1 : 0,
    ]);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.push(Op.Rect, [x, y, w, h]);
  }
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | number[] = 0,
  ): void {
    this.push(Op.RoundRect, [x, y, w, h, ...normalizeRadii(radii)]);
  }

  private replayPath2D(path: CanvasPath2D): void {
    this.push(Op.BeginPath);
    for (const cmd of path._cmds) {
      this.push(
        cmd.op,
        cmd.args,
        cmd.str !== undefined ? [cmd.str] : undefined,
      );
    }
  }

  fill(fillRule?: CanvasFillRule): void;
  fill(path: CanvasPath2D, fillRule?: CanvasFillRule): void;
  fill(
    pathOrRule?: CanvasPath2D | CanvasFillRule,
    maybeRule?: CanvasFillRule,
  ): void {
    if (this.state.fillStyle instanceof CanvasGradient) {
      this.pushGradient(false, this.state.fillStyle);
    }
    let rule: CanvasFillRule = "nonzero";
    if (pathOrRule instanceof CanvasPath2D) {
      this.replayPath2D(pathOrRule);
      if (maybeRule) rule = maybeRule;
    } else if (pathOrRule) {
      rule = pathOrRule;
    }
    this.push(Op.Fill, [rule === "evenodd" ? 1 : 0]);
  }

  stroke(path?: CanvasPath2D): void {
    if (this.state.strokeStyle instanceof CanvasGradient) {
      this.pushGradient(true, this.state.strokeStyle);
    }
    if (path instanceof CanvasPath2D) {
      this.replayPath2D(path);
    }
    this.push(Op.Stroke);
  }

  clip(fillRule?: CanvasFillRule): void;
  clip(path: CanvasPath2D, fillRule?: CanvasFillRule): void;
  clip(
    pathOrRule?: CanvasPath2D | CanvasFillRule,
    maybeRule?: CanvasFillRule,
  ): void {
    let rule: CanvasFillRule = "nonzero";
    if (pathOrRule instanceof CanvasPath2D) {
      this.replayPath2D(pathOrRule);
      if (maybeRule) rule = maybeRule;
    } else if (pathOrRule) {
      rule = pathOrRule;
    }
    this.push(Op.ClipPath, [rule === "evenodd" ? 1 : 0]);
  }

  // --- Images & Pixel Data ---
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(
    image: CanvasImageSource,
    a: number,
    b: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number,
    g?: number,
    h?: number,
  ): void {
    this._flush();
    let sx = 0,
      sy = 0,
      sw = 0,
      sh = 0,
      dx = a,
      dy = b,
      dw = 0,
      dh = 0,
      hasSrc = false;
    if (e !== undefined) {
      sx = a;
      sy = b;
      sw = c!;
      sh = d!;
      dx = e;
      dy = f!;
      dw = g!;
      dh = h!;
      hasSrc = true;
    } else if (c !== undefined) {
      dw = c;
      dh = d!;
    }

    if (image instanceof Canvas) {
      image._flush();
      this.mod.canvas_draw_canvas!(
        this.inst,
        image._inst,
        sx,
        sy,
        sw,
        sh,
        dx,
        dy,
        dw,
        dh,
        hasSrc,
      );
    } else if (image instanceof Uint8Array || image instanceof ArrayBuffer) {
      this.mod.canvas_draw_image_bytes!(
        this.inst,
        image,
        sx,
        sy,
        sw,
        sh,
        dx,
        dy,
        dw,
        dh,
        hasSrc,
      );
    } else if (
      image &&
      typeof image === "object" &&
      "converterInst" in image
    ) {
      this.mod.canvas_draw_converter!(
        this.inst,
        image.converterInst,
        image.frameIndex ?? 0,
        sx,
        sy,
        sw,
        sh,
        dx,
        dy,
        dw,
        dh,
        hasSrc,
      );
    }
  }

  createImageData(sw: number, sh: number): CanvasImageData;
  createImageData(imagedata: CanvasImageData): CanvasImageData;
  createImageData(
    swOrData: number | CanvasImageData,
    sh?: number,
  ): CanvasImageData {
    const w = typeof swOrData === "number" ? swOrData : swOrData.width;
    const h = typeof swOrData === "number" ? sh! : swOrData.height;
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: "srgb",
    };
  }

  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): CanvasImageData {
    this._flush();
    const view = this.mod.canvas_get_image_data!(this.inst, sx, sy, sw, sh);
    if (!view) {
      return this.createImageData(sw, sh);
    }
    return {
      width: sw,
      height: sh,
      data: new Uint8ClampedArray(view),
      colorSpace: "srgb",
    };
  }

  putImageData(imagedata: CanvasImageData, dx: number, dy: number): void {
    this._flush();
    this.mod.canvas_put_image_data!(
      this.inst,
      imagedata.data,
      dx,
      dy,
      imagedata.width,
      imagedata.height,
    );
  }
}

export class Canvas {
  private readonly mod: HtmlToImageModule;
  /** @internal */
  readonly _inst: WasmInstancePtr;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private disposed = false;

  constructor(module: HtmlToImageModule, width = 300, height = 150) {
    if (
      typeof module.canvas_create_instance !== "function" ||
      typeof module.canvas_exec_batch !== "function"
    ) {
      throw new Error(
        "This build of wasm-html-to-image does not include 2D canvas bindings (canvas_*); rebuild the wasm module.",
      );
    }
    const inst = module.canvas_create_instance(width, height);
    if (!inst) {
      throw new Error(
        `Failed to create Canvas (${width}x${height}): invalid dimensions or allocation failure.`,
      );
    }
    this.mod = module;
    this._inst = inst;
  }

  private ensureAlive(): void {
    if (this.disposed) {
      throw new Error("Canvas has already been disposed.");
    }
  }

  get width(): number {
    this.ensureAlive();
    return this.mod.canvas_get_width!(this._inst);
  }
  set width(w: number) {
    this.ensureAlive();
    const h = this.mod.canvas_get_height!(this._inst);
    this.mod.canvas_resize!(this._inst, w, h);
    this.ctx2d?._resetState();
  }

  get height(): number {
    this.ensureAlive();
    return this.mod.canvas_get_height!(this._inst);
  }
  set height(h: number) {
    this.ensureAlive();
    const w = this.mod.canvas_get_width!(this._inst);
    this.mod.canvas_resize!(this._inst, w, h);
    this.ctx2d?._resetState();
  }

  getContext(contextId: "2d"): CanvasRenderingContext2D;
  getContext(contextId: string): CanvasRenderingContext2D | null;
  getContext(contextId: string): CanvasRenderingContext2D | null {
    this.ensureAlive();
    if (contextId !== "2d") return null;
    if (!this.ctx2d) {
      this.ctx2d = new CanvasRenderingContext2D(this, this.mod, this._inst);
    }
    return this.ctx2d;
  }

  /** @internal */
  _flush(): void {
    this.ensureAlive();
    this.ctx2d?._flush();
  }

  encode(options: CanvasEncodeOptions = {}): Uint8Array {
    this._flush();
    const format: OutputFormat = options.format ?? "png";
    const formatInt = FORMAT_INT[format];
    if (formatInt === undefined || formatInt < 0) {
      throw new Error(`Unsupported canvas encode format: ${format}`);
    }
    const quality = options.quality ?? (format === "png" ? 100 : 85);
    const speed = options.speed ?? 6;
    const view = this.mod.canvas_encode!(this._inst, formatInt, quality, speed);
    if (!view) {
      throw new Error(`Failed to encode canvas to ${format}.`);
    }
    return new Uint8Array(view);
  }

  toDataURL(type = "image/png", quality?: number): string {
    const mime = type.toLowerCase();
    const format: OutputFormat =
      mime === "image/jpeg"
        ? "jpeg"
        : mime === "image/webp"
          ? "webp"
          : mime === "image/avif"
            ? "avif"
            : "png";
    const q =
      quality !== undefined
        ? Math.round(Math.max(0, Math.min(1, quality)) * 100)
        : undefined;
    const bytes = this.encode({ format, quality: q });
    const outMime =
      format === "jpeg"
        ? "image/jpeg"
        : format === "webp"
          ? "image/webp"
          : format === "avif"
            ? "image/avif"
            : "image/png";
    return `data:${outMime};base64,${uint8ToBase64(bytes)}`;
  }

  toConverter(converterInst: WasmInstancePtr): boolean {
    this._flush();
    return Boolean(this.mod.canvas_to_converter!(this._inst, converterInst));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mod.canvas_destroy_instance?.(this._inst);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

export function createCanvas(
  module: HtmlToImageModule,
  width = 300,
  height = 150,
): Canvas {
  return new Canvas(module, width, height);
}
