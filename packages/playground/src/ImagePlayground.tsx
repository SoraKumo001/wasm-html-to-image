import { useEffect, useMemo, useRef, useState, type FC } from "react";
import {
  render,
  setLimit,
  launchWorker,
  waitReady,
  type RenderResult,
} from "wasm-html-to-image/workers";
import { useJxlSupport } from "./useJxlSupport";

const Time = () => {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTime((v) => v + 1), 100);
    return () => clearInterval(handle);
  }, []);
  return (
    <div className="inline-flex items-center gap-2 text-xs font-mono bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-200 shadow-xs">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
      </span>
      <span>UI Tick: {time} (Worker non-blocking test)</span>
    </div>
  );
};

const ImageInput: FC<{ onFiles: (files: File[]) => void }> = ({ onFiles }) => {
  const refInput = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex-1">
      <div
        className={`h-36 border-2 border-dashed rounded-xl flex flex-col justify-center items-center text-center p-4 cursor-pointer select-none transition-all ${
          isDragging
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50 text-gray-600"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onClick={() => {
          refInput.current?.click();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) {
            onFiles(Array.from(e.dataTransfer.files));
          }
        }}
      >
        <svg
          className="w-8 h-8 mb-2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="text-sm font-medium">
          Drop images here, paste from clipboard, or click to browse
        </span>
        <span className="text-xs text-gray-400 mt-1">
          Supports JPG, PNG, GIF, SVG, AVIF, WebP
        </span>
      </div>
      <input
        ref={refInput}
        className="hidden"
        type="file"
        multiple
        accept=".jpg,.png,.gif,.svg,.avif,.webp"
        onChange={(e) => {
          e.preventDefault();
          if (e.currentTarget.files) onFiles(Array.from(e.currentTarget.files));
        }}
      />
    </div>
  );
};

const formats = ["none", "avif", "jxl", "webp", "jpeg", "png"] as const;
const fits = ["contain", "cover", "fill"] as const;

export type ImageResult = RenderResult<Uint8Array | string>;

function getImageMimeType(filename: string, fallbackType?: string): string {
  if (fallbackType && fallbackType !== "") return fallbackType;
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "jxl":
      return "image/jxl";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "image/jpeg";
  }
}

const AsyncImage: FC<{
  file: File;
  format: (typeof formats)[number];
  fit: (typeof fits)[number];
  quality: number;
  speed: number;
  filter: boolean;
  animation: boolean;
  size: [number, number];
  onFinished?: ({}: {
    image: ImageResult;
    format: (typeof formats)[number];
    quality: number;
    speed: number;
    animation: boolean;
    time: number;
  }) => void;
}> = ({
  file,
  format,
  fit,
  quality,
  size,
  speed,
  filter,
  animation,
  onFinished,
}) => {
  void filter;
  const [time, setTime] = useState<number>();
  const [image, setImage] = useState<ImageResult | null | undefined>(null);
  const [src, setSrc] = useState<string | null>(null);
  const jxlSupport = useJxlSupport();
  const property = useRef<{ isInit?: boolean }>({}).current;

  if (!property.isInit) {
    property.isInit = true;
    const convert = async () => {
      setImage(null);
      await waitReady();
      const buffer = await file.arrayBuffer();
      const t = performance.now();
      try {
        const res = await render({
          value: new Uint8Array(buffer),
          format,
          fit,
          quality,
          speed,
          animation,
          width: size[0] || 0,
          height: size[1] || undefined,
        });
        const elapsed = performance.now() - t;
        setTime(elapsed);
        setImage(res);
        if (res) {
          onFinished?.({
            image: res,
            format,
            speed,
            quality,
            animation,
            time: elapsed,
          });
        }
      } catch (err) {
        console.error("Conversion failed:", err);
        setImage(undefined);
      }
    };
    convert();
  }

  useEffect(() => {
    if (!image) {
      setSrc(null);
      return;
    }
    const mime =
      format === "none"
        ? image.originalFormat
          ? `image/${image.originalFormat}`
          : getImageMimeType(file.name, file.type)
        : `image/${format}`;
    const url = URL.createObjectURL(
      new Blob([image.data as BufferSource], { type: mime }),
    );
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [image, file, format]);

  const filename =
    !image || format === "none"
      ? file.name
      : file.name.replace(/\.\w+$/, `.${image.format}`);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden relative w-64 h-64 bg-white shadow-xs flex flex-col group">
      {image === undefined && (
        <div className="m-auto text-red-500 font-semibold text-sm flex items-center gap-1">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          Conversion Error
        </div>
      )}
      {src && image && (
        <>
          <a
            target="_blank"
            rel="noreferrer"
            href={src}
            className="flex-1 w-full h-full flex items-center justify-center bg-checkered p-2 overflow-hidden"
          >
            {format === "jxl" && jxlSupport === false ? (
              <span className="text-xs text-gray-400 text-center px-4">
                このブラウザはJXLのプレビューに未対応です（Safariでは表示できます）。ダウンロードボタンからファイルを取得してご確認ください。
              </span>
            ) : (
              <img
                className="max-w-full max-h-full object-contain block transition-transform group-hover:scale-105"
                src={src}
                alt=""
              />
            )}
          </a>
          <div className="bg-white/95 backdrop-blur-xs w-full z-10 p-2.5 border-t border-gray-100 text-xs absolute bottom-0 shadow-xs">
            <div
              className="font-semibold text-gray-800 truncate"
              title={filename}
            >
              {filename}
            </div>
            <div className="flex items-center justify-between mt-1 text-gray-500 font-mono">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  format === "none"
                    ? "bg-gray-100 text-gray-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {format === "none" ? "Original" : format}
              </span>
              <span>
                {time?.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                ms
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-gray-600 font-mono">
              <span>
                {image.width}×{image.height}
              </span>
              <span className="font-medium text-gray-800">
                {Math.ceil(
                  (image.data as Uint8Array).length / 1024,
                ).toLocaleString()}{" "}
                KB
              </span>
            </div>
          </div>
        </>
      )}
      {image === null && (
        <div className="m-auto flex flex-col items-center gap-2">
          <div className="animate-spin h-8 w-8 border-3 border-blue-600 rounded-full border-t-transparent" />
          <span className="text-xs text-gray-400 font-medium">
            Processing...
          </span>
        </div>
      )}
    </div>
  );
};

export const ImagePlayground = () => {
  const [images, setImages] = useState<File[]>([]);
  const [quality, setQuality] = useState(80);
  const [speed, setSpeed] = useState(6);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [fit, setFit] = useState<(typeof fits)[number]>("contain");
  const [limitWorker, setLimitWorker] = useState(10);
  const [formatList, setFormatList] =
    useState<ReadonlyArray<(typeof formats)[number]>>(formats);
  const [filter, setFilter] = useState(true);
  const [animation, setAnimation] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const logText = useMemo(() => logs.join("\n"), [logs]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files?.length) {
        setImages((prev) => [...prev, ...Array.from(e.clipboardData!.files)]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <div className="space-y-4">
      {/* Top Header & Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <Time />
          <span className="text-xs text-gray-500 hidden sm:inline">
            Workers dynamically process images in background threads
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-gray-700 hover:text-red-600 hover:bg-red-50 border border-gray-300 hover:border-red-300 rounded-lg text-xs px-3 py-1.5 font-medium cursor-pointer transition-colors"
            onClick={() => {
              setImages([]);
              setLogs([]);
            }}
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Upload Zone & Logs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ImageInput onFiles={(v) => setImages((i) => [...i, ...v])} />
        <div className="flex flex-col">
          <textarea
            className="w-full h-36 border border-gray-300 p-2.5 rounded-xl bg-gray-50/70 font-mono text-xs text-gray-700 leading-relaxed resize-none focus:outline-blue-500 focus:bg-white transition-colors"
            value={logText}
            readOnly
            placeholder="Conversion benchmarks and logs will appear here..."
          />
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Optimization & Worker Parameters
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <span>Width:</span>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1 w-20 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
              value={size[0]}
              placeholder="Auto"
              onChange={(e) =>
                setSize((v) => [Math.max(0, Number(e.target.value)), v[1]])
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <span>Height:</span>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1 w-20 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
              value={size[1]}
              placeholder="Auto"
              onChange={(e) =>
                setSize((v) => [v[0], Math.max(0, Number(e.target.value))])
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <span>Speed (0-10):</span>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1 w-16 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
              value={speed}
              min={0}
              max={10}
              onChange={(e) =>
                setSpeed(Math.min(10, Math.max(0, Number(e.target.value))))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <span>Quality (0-100):</span>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1 w-16 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
              value={quality}
              min={0}
              max={100}
              onChange={(e) =>
                setQuality(Math.min(100, Math.max(0, Number(e.target.value))))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            <span>Workers:</span>
            <input
              type="number"
              className="border border-gray-300 rounded-lg px-2 py-1 w-16 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
              value={limitWorker}
              min={1}
              onChange={(e) => {
                const limit = Math.max(1, Number(e.target.value));
                setLimitWorker(limit);
                setLimit(limit);
                launchWorker();
              }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded text-blue-600 focus:ring-blue-500"
              checked={filter}
              onChange={(e) => setFilter(e.currentTarget.checked)}
            />
            <span>Resize filter</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded text-blue-600 focus:ring-blue-500"
              checked={animation}
              onChange={(e) => setAnimation(e.currentTarget.checked)}
            />
            <span>Animation</span>
          </label>
        </div>

        <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-gray-600">Fit Mode:</span>
            <div className="flex items-center gap-2">
              {fits.map((f) => (
                <label
                  key={f}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs cursor-pointer select-none transition-colors ${
                    fit === f
                      ? "bg-blue-50 text-blue-700 font-semibold border border-blue-200"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="fit"
                    className="sr-only"
                    value={f}
                    checked={fit === f}
                    onChange={(e) => setFit(e.currentTarget.value as any)}
                  />
                  <span className="capitalize">{f}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-gray-600">Target Formats:</span>
            <div className="flex items-center gap-2">
              {formats.map((format) => {
                const checked = formatList.includes(format);
                return (
                  <label
                    key={format}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs cursor-pointer select-none transition-colors uppercase ${
                      checked
                        ? "bg-blue-50 text-blue-700 font-semibold border border-blue-200"
                        : "text-gray-400 hover:bg-gray-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(e) => {
                        const isChecked = e.currentTarget.checked;
                        if (isChecked) setFormatList((v) => [...v, format]);
                        else
                          setFormatList((v) => v.filter((f) => f !== format));
                      }}
                    />
                    <span>{format}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Image Gallery */}
      {images.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200 text-gray-400 text-sm">
          No images uploaded yet. Drop or paste images to start optimization.
        </div>
      ) : (
        <div className="space-y-4">
          {images.map((file, index) => (
            <div
              key={index}
              className="p-4 bg-white rounded-xl border border-gray-200 shadow-xs space-y-3"
            >
              <div className="text-xs font-semibold text-gray-700 flex items-center justify-between border-b border-gray-100 pb-2">
                <span className="truncate max-w-md">{file.name}</span>
                <span className="text-gray-400 font-mono">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <div className="flex flex-wrap gap-4">
                {formats
                  .filter((f) => formatList.includes(f))
                  .map((format, index2) => (
                    <AsyncImage
                      key={format}
                      file={file}
                      format={format}
                      fit={fit}
                      quality={quality}
                      speed={speed}
                      size={size}
                      filter={filter}
                      animation={animation}
                      onFinished={(v) => {
                        const origW = v.image.originalWidth ?? 0;
                        const origH = v.image.originalHeight ?? 0;
                        const curW = v.image.width ?? 0;
                        const curH = v.image.height ?? 0;
                        const dataLen = (v.image.data as Uint8Array).length;
                        setLogs((l) =>
                          [
                            ...l,
                            `${index}-${index2}-${format.padEnd(4)} ${file.name}(${origW}x${origH}) (${curW}x${curH}) Speed:${speed} Quality:${quality} Animation:${animation} ${Math.ceil(
                              dataLen / 1024,
                            )
                              .toLocaleString()
                              .padStart(8)}KB ${v.time
                              .toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })
                              .padStart(8)}ms`,
                          ].sort((a, b) => (a < b ? -1 : 1)),
                        );
                      }}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImagePlayground;
