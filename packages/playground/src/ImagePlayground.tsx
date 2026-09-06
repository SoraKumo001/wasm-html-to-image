import { useEffect, useMemo, useRef, useState, type FC } from "react";
import {
  render,
  setLimit,
  launchWorker,
  waitReady,
  type RenderResult,
} from "wasm-html-to-image/workers";

const classNames = (...classNames: (string | undefined | false)[]) =>
  classNames.reduce(
    (a, b, index) => a + (b ? (index ? " " : "") + b : ""),
    "",
  ) as string | undefined;

const Time = () => {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTime((v) => v + 1), 100);
    return () => clearInterval(handle);
  }, []);
  return (
    <div>
      {time} ← Test that the UI is working without being blocked during
      conversion.
    </div>
  );
};

const ImageInput: FC<{ onFiles: (files: File[]) => void }> = ({ onFiles }) => {
  const refInput = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  return (
    <>
      <div
        className={classNames(
          "w-64 h-32 border-dashed border flex justify-center items-center cursor-pointer select-none m-2 rounded-4xl p-4",
          focus && "outline outline-blue-400",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDoubleClick={() => {
          refInput.current?.click();
        }}
        onClick={() => {
          refInput.current?.focus();
        }}
        onDrop={(e) => {
          onFiles(Array.from(e.dataTransfer.files));
          e.preventDefault();
        }}
      >
        Drop here, copy and paste or double-click to select the file.
      </div>
      <input
        ref={refInput}
        className="absolute size-0"
        type="file"
        multiple
        accept=".jpg,.png,.gif,.svg,.avif,.webp"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPaste={(e) => {
          e.preventDefault();
          onFiles(Array.from(e.clipboardData.files));
        }}
        onChange={(e) => {
          e.preventDefault();
          if (e.currentTarget.files) onFiles(Array.from(e.currentTarget.files));
        }}
      />
    </>
  );
};

const formats = ["none", "avif", "webp", "jpeg", "png"] as const;
const fits = ["contain", "cover", "fill"] as const;

export type ImageResult = RenderResult<Uint8Array | string>;

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
  const property = useRef<{ isInit?: boolean }>({}).current;
  if (!property.isInit) {
    property.isInit = true;
    const convert = async () => {
      setImage(null);
      // Wait for WebWorkers to become available.
      await waitReady();
      const buffer = await file.arrayBuffer();
      const t = performance.now();
      try {
        let res: ImageResult;
        if (format === "none") {
          const temp = await render({
            value: new Uint8Array(buffer),
            format: "png",
            quality,
            speed,
            animation,
            width: size[0] || 0,
            height: size[1] || undefined,
          });
          res = {
            ...temp,
            data: new Uint8Array(buffer),
            width: temp.originalWidth || temp.width,
            height: temp.originalHeight || temp.height,
            format: "none" as any,
          };
        } else {
          res = await render({
            value: new Uint8Array(buffer),
            format,
            fit,
            quality,
            speed,
            animation,
            width: size[0] || 0,
            height: size[1] || undefined,
          });
        }
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
  const src = useMemo(
    () =>
      image &&
      URL.createObjectURL(
        new Blob([image.data as BufferSource], {
          type: format === "none" ? file.type : `image/${format}`,
        }),
      ),
    [image],
  );
  const filename =
    !image || format === "none"
      ? file.name
      : file.name.replace(/\.\w+$/, `.${image.format}`);
  return (
    <div className="border border-gray-300 rounded-4 overflow-hidden relative w-64 h-64 grid">
      {image === undefined && (
        <div className="m-auto text-red-500 font-bold">Error</div>
      )}
      {src && image && (
        <>
          <a target="_blank" rel="noreferrer" href={src}>
            <img
              className="flex-1 object-contain block overflow-hidden w-full h-full"
              src={src}
              alt=""
            />
          </a>
          <div className="bg-white/80 w-full z-10 text-right p-0 absolute bottom-0 font-bold">
            <div>{filename}</div>
            <div>
              {time?.toLocaleString(undefined, { maximumFractionDigits: 1 })}ms
            </div>
            <div>
              {format !== "none" ? "Optimize" : "Original"}:{" "}
              {image.width.toLocaleString()}x{image.height.toLocaleString()} -{" "}
              {Math.ceil(
                (image.data as Uint8Array).length / 1024,
              ).toLocaleString()}
              KB
            </div>
          </div>
        </>
      )}
      {image === null && (
        <div className="m-auto animate-spin h-10 w-10 border-4 border-blue-600 rounded-full border-t-transparent" />
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

  return (
    <div className="p-4">
      <div>
        <a
          className="text-blue-600 hover:underline font-medium"
          href="https://github.com/SoraKumo001/wasm-html-to-image"
          target="_blank"
          rel="noreferrer"
        >
          Source code (wasm-html-to-image)
        </a>
      </div>
      <div className="text-gray-600 my-1">
        Timer indicating that front-end processing has not stopped:
        <Time />
      </div>
      <div className="flex flex-col md:flex-row gap-4 my-2">
        <ImageInput onFiles={(v) => setImages((i) => [...i, ...v])} />
        <textarea
          className="border flex-1 border-gray-400 p-2 rounded bg-gray-50 font-mono text-xs h-32"
          value={logText}
          readOnly
          placeholder="Conversion logs will appear here..."
        />
      </div>
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <button
          className="text-blue-700 hover:text-white border border-blue-500 hover:bg-blue-600 rounded-lg text-sm px-5 py-2 text-center cursor-pointer transition-colors"
          onClick={() => {
            setImages([]);
            setLogs([]);
          }}
        >
          Clear
        </button>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="number"
            className="border border-gray-300 rounded p-1 w-20"
            value={size[0]}
            onChange={(e) =>
              setSize((v) => [Math.max(0, Number(e.target.value)), v[1]])
            }
          />
          Width(0:Original)
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="number"
            className="border border-gray-300 rounded p-1 w-20"
            value={size[1]}
            onChange={(e) =>
              setSize((v) => [v[0], Math.max(0, Number(e.target.value))])
            }
          />
          Height(0:Original)
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="number"
            className="border border-gray-300 rounded p-1 w-16"
            value={speed}
            onChange={(e) =>
              setSpeed(Math.min(10, Math.max(0, Number(e.target.value))))
            }
          />
          Speed(0-10): Avif
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="number"
            className="border border-gray-300 rounded p-1 w-16"
            value={quality}
            onChange={(e) =>
              setQuality(Math.min(100, Math.max(0, Number(e.target.value))))
            }
          />
          Quality(0-100): Avif, Jpeg, WebP
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="number"
            className="border border-gray-300 rounded p-1 w-16"
            value={limitWorker}
            onChange={(e) => {
              const limit = Math.max(1, Number(e.target.value));
              setLimitWorker(limit);
              setLimit(limit);
              launchWorker();
            }}
          />
          Web Workers(1-)
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            className="rounded"
            checked={filter}
            onChange={(e) => setFilter(e.currentTarget.checked)}
          />
          Resize filter
        </label>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            className="rounded"
            checked={animation}
            onChange={(e) => setAnimation(e.currentTarget.checked)}
          />
          Animation
        </label>
      </div>
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <div className="flex gap-2 items-center text-sm font-medium">
          Fit:
          {fits.map((f) => (
            <label key={f} className="flex gap-1 items-center font-normal">
              <input
                type="radio"
                name="fit"
                value={f}
                checked={fit === f}
                onChange={(e) => setFit(e.currentTarget.value as any)}
              />
              {f}
            </label>
          ))}
        </div>
        <div className="flex gap-3 items-center text-sm font-medium">
          Formats:
          {formats.map((format) => (
            <label key={format} className="flex gap-1 items-center font-normal">
              <input
                type="checkbox"
                checked={formatList.includes(format)}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  if (checked) setFormatList((v) => [...v, format]);
                  else setFormatList((v) => v.filter((f) => f !== format));
                }}
              />
              {format}
            </label>
          ))}
        </div>
      </div>
      <hr className="my-4 border-gray-200" />
      <div className="flex flex-col gap-6">
        {images.map((file, index) => (
          <div
            key={index}
            className="flex flex-wrap gap-4 p-3 bg-gray-50/50 rounded-lg border border-gray-200"
          >
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
        ))}
      </div>
    </div>
  );
};

export default ImagePlayground;
