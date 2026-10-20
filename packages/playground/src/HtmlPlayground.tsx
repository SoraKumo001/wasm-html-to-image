import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  render,
  LogLevel,
  DEFAULT_FONT_MAP,
  type RenderDiagnostics,
} from "wasm-html-to-image/workers";
import { useJxlSupport } from "./useJxlSupport";

type Params = {
  asset?: string;
  width: number;
  height?: number;
  format: "svg" | "png" | "webp" | "avif" | "jxl" | "pdf";
  textToPaths: boolean;
  value?: string | null;
  mediaType: "screen" | "print";
  animationEnabled: boolean;
  animationDuration: number;
  animationFps: number;
  animationLoop: number;
};

import SHOWCASE_SAMPLE_HTML from "./showcase-sample.html?raw";

const SHOWCASE_SAMPLE_KEY = "showcase-sample";
const ANIMATION_SAMPLE_KEY = "animation-sample";
const ANIMATION_SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <style>
    @keyframes pulse-rotate {
      0% {
        transform: rotate(0deg) scale(0.85);
        opacity: 0.6;
        background-color: #3b82f6;
        color: #ffffff;
      }
      50% {
        transform: rotate(180deg) scale(1.1);
        opacity: 1;
        background-color: #ef4444;
        color: #ffffff;
      }
      100% {
        transform: rotate(360deg) scale(0.85);
        opacity: 0.6;
        background-color: #3b82f6;
        color: #ffffff;
      }
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 30px;
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 480px;
      box-sizing: border-box;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      padding: 32px 48px;
      text-align: center;
      max-width: 420px;
    }
    h2 {
      margin: 0 0 8px 0;
      color: #1e293b;
      font-size: 22px;
    }
    p {
      margin: 0 0 24px 0;
      color: #64748b;
      font-size: 14px;
    }
    .badge {
      width: 110px;
      height: 110px;
      margin: 0 auto;
      border-radius: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
      animation: pulse-rotate 2s infinite ease-in-out;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Animated WebP</h2>
    <p>CSS @keyframes (transform, opacity, color)</p>
    <div class="badge">WebP</div>
  </div>
</body>
</html>`;

const App: React.FC = () => {
  const [assetList] = useState<string[]>(() => {
    const assetFiles = import.meta.glob("../../visual-test/assets/*.html", {
      query: "?url",
      import: "default",
    });
    return Object.keys(assetFiles).map((path) => path.split("/").pop()!);
  });
  // Initialize state from URL parameters
  const [params, setParams] = useState<Params>(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get("asset");
    const w = params.get("width");
    const h = params.get("height");
    const f = params.get("format");
    const t = params.get("textToPaths");
    const v = params.get("value");
    const anim = params.get("anim");
    const dur = params.get("dur");
    const fps = params.get("fps");
    const loop = params.get("loop");
    return {
      asset: !v ? a || assetList[0] : undefined,
      width: w ? parseInt(w) : 588,
      height: h ? parseInt(h) : undefined,
      format:
        f && ["svg", "png", "webp", "avif", "jxl", "pdf"].includes(f)
          ? (f as any)
          : "webp",
      textToPaths: t !== null ? t === "true" : true,
      value: v,
      mediaType: params.get("mediaType") === "print" ? "print" : "screen",
      animationEnabled: anim === "true",
      animationDuration: dur ? parseInt(dur) || 2000 : 2000,
      animationFps: fps ? parseInt(fps) || 15 : 15,
      animationLoop: loop !== null ? parseInt(loop) || 0 : 0,
    };
  });

  const [fontMapJson, setFontMapJson] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const initialFontMap = params.get("fontMap");
    if (initialFontMap) {
      try {
        const parsed = JSON.parse(initialFontMap);
        return JSON.stringify(parsed, null, 2);
      } catch (e) {
        // ignore
        void e;
      }
    }
    return JSON.stringify(DEFAULT_FONT_MAP, null, 2);
  });

  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderResult, setRenderResult] = useState<string | Uint8Array | null>(
    null,
  );
  const [diagnostics, setDiagnostics] = useState<RenderDiagnostics | null>(
    null,
  );
  const [logs, setLogs] = useState<{ level: LogLevel; message: string }[]>([]);
  const [inspectorTab, setInspectorTab] = useState<string>("Output");
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOutputAnimated, setIsOutputAnimated] = useState<boolean>(false);
  const jxlSupport = useJxlSupport();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  // The live preview is scaled down (never up) to fit the box width, like the render preview.
  const [previewScale, setPreviewScale] = useState(1);
  useEffect(() => {
    const box = previewBoxRef.current;
    if (!box) return;
    const update = () => {
      // offsetWidth does not change when the vertical scrollbar appears (clientWidth does,
      // which made the scale oscillate): subtract the border and a fixed scrollbar width.
      const available = box.offsetWidth - 2 - 17;
      const next =
        params.width > 0 && available > 0
          ? Math.min(1, available / params.width)
          : 1;
      // Ignore sub-pixel noise so a tiny change cannot retrigger the layout.
      setPreviewScale((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [params.width]);
  const latestRenderId = useRef<number>(0);
  const shouldRenderImmediately = useRef<boolean>(false);
  void shouldRenderImmediately;

  // Initialize worker pool lazily on first render (no explicit init needed)
  useEffect(() => {
    // Handle browser back/forward
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const a = p.get("asset");
      const w = p.get("width");
      const h = p.get("height");
      const f = p.get("format");
      const t = p.get("textToPaths");
      const anim = p.get("anim");
      const dur = p.get("dur");
      const fps = p.get("fps");
      const loop = p.get("loop");

      setParams({
        asset: a ?? undefined,
        value: p.get("value"),
        width: w ? parseInt(w) : 588,
        height: h ? parseInt(h) : undefined,
        format:
          f && ["svg", "png", "webp", "avif", "jxl", "pdf"].includes(f)
            ? (f as any)
            : "webp",
        textToPaths: t !== null ? t === "true" : true,
        mediaType: p.get("mediaType") === "print" ? "print" : "screen",
        animationEnabled: anim === "true",
        animationDuration: dur ? parseInt(dur) || 2000 : 2000,
        animationFps: fps ? parseInt(fps) || 15 : 15,
        animationLoop: loop !== null ? parseInt(loop) || 0 : 0,
      });

      if (a) {
        loadAsset(a);
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
  const updateParams = (
    params: Record<string, string | number | boolean | undefined>,
  ) => {
    const url = new URL(location.href);
    const p = url.searchParams;
    Object.entries(params).forEach(([name, value]) => {
      if (value !== undefined && value !== "" && value !== false) {
        p.set(name, String(value));
      } else {
        p.delete(name);
      }
    });
    if (p.get("asset")) {
      p.delete("value");
    }

    const w = p.get("width");
    const h = p.get("height");
    const f = p.get("format");
    const t = p.get("textToPaths");
    const a = p.get("asset");
    const anim = p.get("anim");
    const dur = p.get("dur");
    const fps = p.get("fps");
    const loop = p.get("loop");
    history.replaceState({}, "", url.toString());
    setParams((prev) => ({
      width: w ? parseInt(w) : 588,
      height: h ? parseInt(h) : undefined,
      format:
        f && ["svg", "png", "webp", "avif", "jxl", "pdf"].includes(f)
          ? (f as any)
          : "webp",
      textToPaths: t !== null ? t === "true" : true,
      asset: a ?? undefined,
      value: params.value !== undefined ? (params.value as string) : prev.value,
      mediaType: p.get("mediaType") === "print" ? "print" : "screen",
      animationEnabled:
        params.anim !== undefined
          ? params.anim === true || params.anim === "true"
          : anim === "true",
      animationDuration: dur ? parseInt(dur) || 2000 : prev.animationDuration,
      animationFps: fps ? parseInt(fps) || 15 : prev.animationFps,
      animationLoop: loop !== null ? parseInt(loop) || 0 : prev.animationLoop,
    }));
  };

  const memoryParam = useRef<Params>(null);
  // Auto-run render when specific parameters change
  useEffect(() => {
    const oldParams = memoryParam.current;
    if (oldParams === params) return;
    memoryParam.current = params;

    const debouncedKeys: (keyof Params)[] = [
      "width",
      "height",
      "value",
      "animationDuration",
      "animationFps",
      "animationLoop",
    ];

    if (
      !oldParams ||
      oldParams["asset"] !== params["asset"] ||
      debouncedKeys.every((v) => oldParams[v] === params[v])
    ) {
      handleConvert();
    } else {
      const t = setTimeout(handleConvert, 500);
      return () => clearTimeout(t);
    }
  }, [params]);

  // Update iframe preview
  useEffect(() => {
    if (iframeRef.current) {
      const html = params.value ?? "";
      const doc =
        iframeRef.current.contentDocument ||
        iframeRef.current.contentWindow?.document;
      if (doc) {
        doc.open();
        const baseTag = `<base href="${window.location.origin}${window.location.pathname}assets/">`;
        // Hide scrollbars inside iframe
        const styleTag = `<style>body { overflow: hidden; } html { overflow: hidden; }</style>`;
        const htmlWithBase = html.includes("<head>")
          ? html.replace("<head>", `<head>${baseTag}${styleTag}`)
          : baseTag + styleTag + html;
        doc.write(htmlWithBase);
        doc.close();

        // Adjust height to fit content
        const resizeIframe = () => {
          if (iframeRef.current && iframeRef.current.contentWindow) {
            if (params.height) {
              iframeRef.current.style.height = `${params.height}px`;
              return;
            }
            const body = iframeRef.current.contentWindow.document.body;
            const docEl =
              iframeRef.current.contentWindow.document.documentElement;

            if (!body || !docEl) return;

            // Get the maximum height to ensure no scrollbars
            const heightValue = Math.max(
              body.scrollHeight,
              body.offsetHeight,
              docEl.clientHeight,
              docEl.scrollHeight,
              docEl.offsetHeight,
            );
            iframeRef.current.style.height = `${heightValue}px`;
          }
        };

        // Resize immediately and on load (for images)
        resizeIframe();
        iframeRef.current.onload = resizeIframe;
        // Also set a timeout to catch layout shifts
        setTimeout(resizeIframe, 100);
        setTimeout(resizeIframe, 500);
      }
    }
  }, [params.value, params.width, params.height]);

  // Handle asset selection (Initial or when assetList is loaded)
  useEffect(() => {
    if (
      (params.asset === ANIMATION_SAMPLE_KEY ||
        params.asset === SHOWCASE_SAMPLE_KEY) &&
      !params.value
    ) {
      loadAsset(params.asset);
      return;
    }
    if (assetList.length === 0 || !params.asset) return;

    const initialAsset =
      assetList.find((v) => v === params.asset) ?? assetList[0];
    loadAsset(initialAsset);
  }, []);
  const loadAsset = async (name: string) => {
    if (name === SHOWCASE_SAMPLE_KEY) {
      shouldRenderImmediately.current = true;
      updateParams({
        asset: name,
        value: SHOWCASE_SAMPLE_HTML,
        width: 900,
        format: "webp",
        anim: true,
      });
      return;
    }
    if (name === ANIMATION_SAMPLE_KEY) {
      shouldRenderImmediately.current = true;
      updateParams({
        asset: name,
        value: ANIMATION_SAMPLE_HTML,
        format: "webp",
        anim: true,
      });
      return;
    }
    try {
      const resp = await fetch(`assets/${name}`);
      const text = await resp.text();
      shouldRenderImmediately.current = true;
      updateParams({ asset: name, value: text });
    } catch (e) {
      console.error("Failed to load asset", e);
    }
  };
  const property = useRef({ isRender: false });

  const handleConvert = async () => {
    if (property.current.isRender) return;
    const currentHtml = params.value;
    if (!currentHtml) return;
    const requestId = ++latestRenderId.current;

    setIsRendering(true);
    setError(null);
    setRenderTime(null);
    setDiagnostics(null);
    setLogs([]);

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }

    const startTime = performance.now();
    try {
      let fontMap = DEFAULT_FONT_MAP;
      try {
        fontMap = JSON.parse(fontMapJson);
      } catch (e) {
        console.warn("Invalid fontMap JSON, using default");
        void e;
      }

      console.log(
        `[wasm-html-to-image] Rendering via Worker (ID: ${requestId})`,
      );
      const { width, height, format, textToPaths, mediaType } = params;
      const animationOpt =
        params.format === "webp" && params.animationEnabled
          ? {
              duration: params.animationDuration,
              fps: params.animationFps,
              loop: params.animationLoop,
            }
          : undefined;

      const result = await render({
        value: currentHtml,
        width,
        height,
        format,
        textToPaths,
        fontMap,
        mediaType,
        animation: animationOpt,
        diagnostics: true,
        onDiagnostics: (report) => {
          if (requestId === latestRenderId.current) {
            setDiagnostics(report);
          }
        },
        logLevel: LogLevel.Info,
        onLog: (level, message) => {
          if (requestId !== latestRenderId.current) return;
          setLogs((prev) => [...prev, { level, message }]);
          const prefix = "[wasm-html-to-image Worker]";
          switch (level) {
            case LogLevel.Debug:
              console.debug(`${prefix} DEBUG: ${message}`);
              break;
            case LogLevel.Info:
              console.info(`${prefix} INFO: ${message}`);
              break;
            case LogLevel.Warning:
              console.warn(`${prefix} WARNING: ${message}`);
              break;
            case LogLevel.Error:
              console.error(`${prefix} ERROR: ${message}`);
              break;
          }
        },
        css: "body { margin: 8px; }",
        baseUrl: `${window.location.origin}${window.location.pathname}assets/`,
        resolveResource: async (url, fallback) => {
          if (requestId !== latestRenderId.current) return null;
          console.log(`[Playground] Resolving: ${url}`);
          // Open Cache storage
          const cache = await caches.open("wasm-html-to-image-resource-cache");
          const cachedResponse = await cache.match(url);

          if (cachedResponse) {
            console.log(`[Playground] Cache Hit: ${url}`);
            const buf = await cachedResponse.arrayBuffer();
            return new Uint8Array(buf);
          }

          // Fetch using fallback (built-in resolution)
          const data = await fallback();
          if (data?.length)
            await cache.put(url, new Response(data as BodyInit));

          return data;
        },
      });
      property.current.isRender = false;

      if (requestId !== latestRenderId.current) {
        console.log(
          `[wasm-html-to-image] Render result discarded (ID: ${requestId})`,
        );
        return;
      }

      const endTime = performance.now();
      setRenderTime(endTime - startTime);
      setRenderResult(result.data);
      setIsOutputAnimated(Boolean(result.animation));

      if (result.data instanceof Uint8Array) {
        const mimeType =
          format === "png"
            ? "image/png"
            : format === "webp"
              ? "image/webp"
              : format === "avif"
                ? "image/avif"
                : format === "jxl"
                  ? "image/jxl"
                  : "application/pdf";
        const blob = new Blob([result.data.slice()], { type: mimeType });
        setObjectUrl(URL.createObjectURL(blob));
      }
    } catch (e: any) {
      if (requestId !== latestRenderId.current) return;
      console.error("Conversion failed:", e);
      setError(e.message);
    } finally {
      if (requestId === latestRenderId.current) {
        setIsRendering(false);
      }
    }
  };

  const outputSource = useMemo(() => {
    if (!renderResult) return "";
    if (typeof renderResult === "string") return renderResult;

    // Binary to Base64
    let binary = "";
    const len = renderResult.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(renderResult[i]);
    }
    return btoa(binary);
  }, [renderResult]);

  const handleDownload = () => {
    if (!renderResult) return;
    const { format } = params;
    const mimeType =
      format === "svg"
        ? "image/svg+xml"
        : format === "png"
          ? "image/png"
          : format === "webp"
            ? "image/webp"
            : format === "avif"
              ? "image/avif"
              : format === "jxl"
                ? "image/jxl"
                : "application/pdf";
    const content =
      typeof renderResult === "string" ? renderResult : renderResult.slice();
    const blob = new Blob([content as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rendered.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "sans-serif",
        maxWidth: "1200px",
        margin: "0 auto",
        background: "#fafafa",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "2px solid #2196F3",
          marginBottom: "20px",
          paddingBottom: "10px",
        }}
      >
        <h2 style={{ color: "#2196F3", margin: 0 }}>
          wasm-html-to-image Playground
        </h2>
      </header>

      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        <fieldset
          style={{
            flex: 1,
            padding: "15px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            background: "white",
          }}
        >
          <legend style={{ fontWeight: "bold" }}>Rendering Options</legend>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <label>
                Width
                <div style={{ display: "flex" }}>
                  <input
                    type="number"
                    value={params.width}
                    onChange={(e) => {
                      updateParams({ width: parseInt(e.target.value) || 0 });
                    }}
                    style={{ width: "80px" }}
                  />
                </div>
              </label>

              <label>
                Height
                <div style={{ display: "flex" }}>
                  <input
                    type="number"
                    value={params.height ?? 0}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateParams({
                        height: val === "" ? "auto" : parseInt(val),
                      });
                    }}
                    disabled={!params.height}
                    style={{ width: "80px" }}
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!params.height}
                      onChange={(e) =>
                        updateParams(
                          e.target.checked
                            ? { height: undefined }
                            : { height: 800 },
                        )
                      }
                    />{" "}
                    Auto
                  </label>
                </div>
              </label>
            </div>
            <label>
              Format:{" "}
              <select
                value={params.format}
                onChange={(e) => updateParams({ format: e.target.value })}
                style={{ padding: "2px 5px", borderRadius: "4px" }}
              >
                <option value="svg">SVG (Vector)</option>
                <option value="png">PNG (Raster)</option>
                <option value="webp">WebP (Raster)</option>
                <option value="avif">AVIF (Raster)</option>
                <option value="jxl">JXL (Raster)</option>
                <option value="pdf">PDF (Document)</option>
              </select>
            </label>
            {params.format === "webp" && (
              <div
                style={{
                  background: "#f0f9ff",
                  border: "1px solid #bae6fd",
                  borderRadius: "6px",
                  padding: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "#0369a1",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={params.animationEnabled}
                    onChange={(e) =>
                      updateParams({ anim: e.target.checked || undefined })
                    }
                  />
                  Enable Animation (WebP)
                </label>

                {params.animationEnabled && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "10px",
                      fontSize: "12px",
                      color: "#334155",
                      paddingLeft: "4px",
                    }}
                  >
                    <label style={{ display: "flex", flexDirection: "column" }}>
                      Duration (ms)
                      <input
                        type="number"
                        min={100}
                        max={5000}
                        step={100}
                        value={params.animationDuration}
                        onChange={(e) =>
                          updateParams({
                            dur: parseInt(e.target.value) || 2000,
                          })
                        }
                        style={{
                          width: "85px",
                          padding: "2px 4px",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                        }}
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column" }}>
                      FPS
                      <select
                        value={params.animationFps}
                        onChange={(e) =>
                          updateParams({
                            fps: parseInt(e.target.value) || 15,
                          })
                        }
                        style={{
                          padding: "2px 4px",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                        }}
                      >
                        <option value={10}>10 fps</option>
                        <option value={15}>15 fps (default)</option>
                        <option value={20}>20 fps</option>
                        <option value={24}>24 fps</option>
                        <option value={30}>30 fps</option>
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column" }}>
                      Loop
                      <select
                        value={params.animationLoop}
                        onChange={(e) =>
                          updateParams({
                            loop: parseInt(e.target.value) || 0,
                          })
                        }
                        style={{
                          padding: "2px 4px",
                          borderRadius: "4px",
                          border: "1px solid #cbd5e1",
                        }}
                      >
                        <option value={0}>Infinite (0)</option>
                        <option value={1}>Play Once (1)</option>
                        <option value={2}>2 times</option>
                        <option value={3}>3 times</option>
                        <option value={5}>5 times</option>
                      </select>
                    </label>

                    <div
                      style={{
                        width: "100%",
                        fontSize: "11px",
                        color: "#64748b",
                      }}
                    >
                      Estimated frames: ~
                      {Math.min(
                        75,
                        Math.max(
                          2,
                          Math.round(
                            (params.animationDuration * params.animationFps) /
                              1000,
                          ),
                        ),
                      )}{" "}
                      (max 75 frames / 5000ms)
                    </div>
                  </div>
                )}
              </div>
            )}
            {params.format === "svg" && (
              <label>
                <input
                  type="checkbox"
                  checked={params.textToPaths}
                  onChange={(e) =>
                    updateParams({
                      textToPaths: e.target.checked || undefined,
                    })
                  }
                />{" "}
                Convert text to paths
              </label>
            )}
            <label>
              Media Type:{" "}
              <select
                value={params.mediaType}
                onChange={(e) => updateParams({ mediaType: e.target.value })}
                style={{ padding: "2px 5px", borderRadius: "4px" }}
              >
                <option value="screen">Screen</option>
                <option value="print">Print</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset
          style={{
            flex: 1,
            padding: "15px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            background: "white",
          }}
        >
          <legend style={{ fontWeight: "bold" }}>Font Mapping (default)</legend>
          <textarea
            value={fontMapJson}
            onChange={(e) => setFontMapJson(e.target.value)}
            style={{
              width: "100%",
              height: "100px",
              fontFamily: "monospace",
              fontSize: "12px",
              padding: "5px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              boxSizing: "border-box",
            }}
          />
        </fieldset>

        <fieldset
          style={{
            flex: 1,
            padding: "15px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            background: "white",
          }}
        >
          <legend style={{ fontWeight: "bold" }}>Load Sample Assets</legend>
          <select
            value={params.asset ?? ""}
            onChange={(e) => loadAsset(e.target.value)}
            style={{
              padding: "5px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              width: "100%",
            }}
          >
            <option value="">-- Select Asset --</option>
            <option value={SHOWCASE_SAMPLE_KEY}>
              🌟 Showcase (new CSS, vertical writing, animation)
            </option>
            <option value={ANIMATION_SAMPLE_KEY}>
              ✨ CSS Animation (@keyframes)
            </option>
            {assetList.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      <div style={{ marginBottom: "15px" }}>
        <h3>HTML Input:</h3>
        <textarea
          value={params.value ?? undefined}
          onChange={(e) => {
            updateParams({ value: e.target.value, asset: undefined });
          }}
          style={{
            width: "100%",
            height: "150px",
            fontFamily: "monospace",
            padding: "10px",
            borderRadius: "4px",
            border: "1px solid #ccc",
            boxSizing: "border-box",
          }}
        />
      </div>

      <button
        onClick={() => handleConvert()}
        disabled={isRendering}
        style={{
          padding: "15px 30px",
          fontSize: "20px",
          cursor: "pointer",
          background: isRendering ? "#ccc" : "#2196F3",
          color: "white",
          border: "none",
          borderRadius: "4px",
          width: "100%",
          fontWeight: "bold",
          marginBottom: "10px",
          boxShadow: "0 4px 6px rgba(33, 150, 243, 0.3)",
        }}
      >
        {isRendering ? "Processing..." : "Generate Output"}
      </button>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          fontSize: "14px",
          color: "#666",
          marginBottom: "20px",
          minHeight: "20px",
        }}
      >
        {renderTime !== null && (
          <span>
            Render Time: <strong>{renderTime.toFixed(2)}ms</strong>
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "10px",
            background: "#ffebee",
            color: "#c62828",
            borderRadius: "4px",
            marginBottom: "20px",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              minHeight: "36px",
              marginBottom: "8px",
            }}
          >
            <h3 style={{ margin: 0 }}>HTML Live Preview (iframe):</h3>
          </div>
          <div
            ref={previewBoxRef}
            style={{
              border: "1px solid #ccc",
              borderRadius: "4px",
              height: "800px",
              background: "white",
              overflowY: "scroll",
              overflowX: "hidden",
              boxSizing: "border-box",
            }}
          >
            <iframe
              ref={iframeRef}
              title="preview"
              style={{
                width: `${params.width}px`,
                minHeight: "100%",
                border: "none",
                display: "block",
                // `zoom` scales the layout box too, so the box scrolls by the scaled size.
                zoom: previewScale,
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              minHeight: "36px",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h3 style={{ margin: 0 }}>
                {params.format.toUpperCase()} Render Preview:
              </h3>
              {params.format === "webp" && isOutputAnimated && (
                <span
                  style={{
                    background: "#0284c7",
                    color: "white",
                    fontSize: "11px",
                    fontWeight: "bold",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Animated
                </span>
              )}
              {params.format === "webp" &&
                params.animationEnabled &&
                !isOutputAnimated &&
                renderResult && (
                  <span
                    style={{
                      background: "#e2e8f0",
                      color: "#64748b",
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                    title="No supported @keyframes found in HTML; rendered as static image"
                  >
                    Static (No @keyframes)
                  </span>
                )}
            </div>
            {renderResult && (
              <button
                onClick={handleDownload}
                style={{
                  background: "#FF9800",
                  color: "white",
                  border: "none",
                  padding: "0 15px",
                  height: "32px",
                  display: "inline-flex",
                  alignItems: "center",
                  cursor: "pointer",
                  borderRadius: "4px",
                }}
              >
                Download
              </button>
            )}
          </div>
          <div
            style={{
              border: "1px solid #ccc",
              borderRadius: "4px",
              background: "white",
              height: "800px",
              display: "flex",
              overflow: "auto",
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {isRendering && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(255, 255, 255, 0.7)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  zIndex: 10,
                  fontWeight: "bold",
                  color: "#2196F3",
                  backdropFilter: "blur(2px)",
                }}
              >
                Rendering {params.format.toUpperCase()}...
              </div>
            )}
            {!renderResult && !isRendering && (
              <div
                style={{
                  color: "#999",
                  marginTop: "200px",
                  textAlign: "center",
                  width: "100%",
                }}
              >
                Result will appear here
              </div>
            )}
            {renderResult && params.format === "svg" && (
              <div
                dangerouslySetInnerHTML={{ __html: renderResult as string }}
              />
            )}
            {objectUrl &&
              (params.format === "png" ||
                params.format === "webp" ||
                params.format === "avif" ||
                (params.format === "jxl" && jxlSupport !== false)) && (
                <div>
                  <img
                    src={objectUrl}
                    alt="render result"
                    style={{
                      boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
                    }}
                  />
                </div>
              )}
            {objectUrl &&
              params.format === "jxl" &&
              jxlSupport === false && (
                <div
                  style={{
                    color: "#999",
                    marginTop: "200px",
                    textAlign: "center",
                    width: "100%",
                  }}
                >
                  このブラウザはJXLのプレビューに未対応です（Safariでは表示できます）。ダウンロードボタンからファイルを取得してご確認ください。
                </div>
              )}
            {objectUrl && params.format === "pdf" && (
              <embed
                src={objectUrl}
                type="application/pdf"
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "30px" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #ccc" }}>
          {[
            "Output",
            "Diagnostics",
            "Resources",
            "Fonts",
            "Timings",
            "Logs",
          ].map((tab) => (
            <button
              key={tab}
              onClick={() => setInspectorTab(tab)}
              style={{
                padding: "10px 20px",
                cursor: "pointer",
                background: inspectorTab === tab ? "white" : "#eee",
                border: "1px solid #ccc",
                borderBottom: inspectorTab === tab ? "none" : "1px solid #ccc",
                borderRadius: "4px 4px 0 0",
                marginRight: "4px",
                fontWeight: inspectorTab === tab ? "bold" : "normal",
                color: inspectorTab === tab ? "#2196F3" : "#666",
              }}
            >
              {tab}
              {tab === "Logs" && logs.length > 0 && (
                <span
                  style={{
                    marginLeft: "6px",
                    background: "#f44336",
                    color: "white",
                    borderRadius: "10px",
                    padding: "0 6px",
                    fontSize: "11px",
                  }}
                >
                  {logs.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          style={{
            border: "1px solid #ccc",
            borderTop: "none",
            padding: "20px",
            background: "white",
            minHeight: "400px",
            borderRadius: "0 0 4px 4px",
          }}
        >
          {inspectorTab === "Output" && (
            <div>
              <h3>
                Output Source {params.format !== "svg" ? "(Base64)" : ""}:
              </h3>
              <textarea
                value={outputSource}
                readOnly
                style={{
                  width: "100%",
                  height: "300px",
                  fontFamily: "monospace",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                  background: "#fdfdfd",
                }}
              />
            </div>
          )}

          {inspectorTab === "Diagnostics" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3>Diagnostics JSON:</h3>
                {diagnostics && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        JSON.stringify(diagnostics, null, 2),
                      );
                    }}
                    style={{
                      padding: "4px 10px",
                      cursor: "pointer",
                      background: "#2196F3",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                    }}
                  >
                    Copy JSON
                  </button>
                )}
              </div>
              <textarea
                value={
                  diagnostics
                    ? JSON.stringify(diagnostics, null, 2)
                    : "No diagnostics available"
                }
                readOnly
                style={{
                  width: "100%",
                  height: "400px",
                  fontFamily: "monospace",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  boxSizing: "border-box",
                  background: "#fdfdfd",
                }}
              />
            </div>
          )}

          {inspectorTab === "Resources" && (
            <div>
              <h3>Resolved Resources:</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Type
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      URL
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Status
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics?.resources?.map((res, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px" }}>{res.type}</td>
                      <td
                        style={{
                          padding: "8px",
                          maxWidth: "400px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={res.url}
                      >
                        {res.url}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "white",
                            background:
                              res.status === "loaded"
                                ? "#4caf50"
                                : res.status === "failed"
                                  ? "#f44336"
                                  : "#ff9800",
                          }}
                        >
                          {res.status}
                        </span>
                      </td>
                      <td style={{ padding: "8px" }}>
                        {res.bytes
                          ? `${(res.bytes / 1024).toFixed(1)} KB`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                  {(!diagnostics?.resources ||
                    diagnostics.resources.length === 0) && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#999",
                        }}
                      >
                        No resources recorded
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Fonts tab shows JS-side best-effort records only: per-glyph C++
              diagnostics have no WASM binding in this build, so entries
              describe fonts this layer loaded, not renderer-matched faces.
              (Unwired by design; future C++ work could enrich this.) */}
          {inspectorTab === "Fonts" && (
            <div>
              <h3>Font Usage:</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Family
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Weight/Style
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Status
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics?.fonts?.map((f, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px" }}>{f.family}</td>
                      <td style={{ padding: "8px" }}>
                        {f.weight} {f.style}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "white",
                            background:
                              f.status === "loaded"
                                ? "#4caf50"
                                : f.status === "missing"
                                  ? "#f44336"
                                  : "#2196f3",
                          }}
                        >
                          {f.status}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          maxWidth: "300px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={f.source}
                      >
                        {f.source || "-"}
                      </td>
                    </tr>
                  ))}
                  {(!diagnostics?.fonts || diagnostics.fonts.length === 0) && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#999",
                        }}
                      >
                        No font information available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {inspectorTab === "Timings" && (
            <div>
              <h3>Render Timings:</h3>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Phase
                    </th>
                    <th
                      style={{ padding: "8px", borderBottom: "2px solid #ddd" }}
                    >
                      Duration (ms)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics &&
                    Object.entries(diagnostics.timings).map(([name, ms], i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "8px" }}>{name}</td>
                        <td style={{ padding: "8px" }}>{ms.toFixed(2)}</td>
                      </tr>
                    ))}
                  {!diagnostics && (
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#999",
                        }}
                      >
                        No timing data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Logs tab shows JS-side onLog records only: C++ WASM-side logs
              are not captured (no binding; future C++ work could forward
              them). Kept as-is by design. */}
          {inspectorTab === "Logs" && (
            <div>
              <h3>Worker Logs:</h3>
              <div
                style={{
                  maxHeight: "400px",
                  overflowY: "auto",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  background: "#333",
                  color: "#eee",
                  padding: "10px",
                  borderRadius: "4px",
                }}
              >
                {logs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: "4px",
                      borderBottom: "1px solid #444",
                      paddingBottom: "2px",
                      color:
                        log.level === LogLevel.Error
                          ? "#ff8a80"
                          : log.level === LogLevel.Warning
                            ? "#ffd180"
                            : "#eee",
                    }}
                  >
                    <span style={{ opacity: 0.6, marginRight: "8px" }}>
                      [{LogLevel[log.level]}]
                    </span>
                    {log.message}
                  </div>
                ))}
                {logs.length === 0 && (
                  <div
                    style={{
                      textAlign: "center",
                      color: "#888",
                      padding: "20px",
                    }}
                  >
                    No logs recorded
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export { App as HtmlPlayground };
export default App;
