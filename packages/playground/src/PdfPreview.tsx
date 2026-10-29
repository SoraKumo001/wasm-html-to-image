import React from "react";

interface Props {
  url: string | null;
  bytes: Uint8Array | null;
  busy: boolean;
  error: string | null;
  /** Milliseconds the last conversion took. */
  time: number | null;
  /** File name offered by the download button. */
  fileName?: string;
}

/** The PDF of a conversion: the viewer, progress, the error, the time, and the download button. */
export const PdfPreview: React.FC<Props> = ({ url, bytes, busy, error, time, fileName = "document.pdf" }) => {
  const download = () => {
    if (!bytes) return;
    const blob = new Blob([bytes.slice()], { type: "application/pdf" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 100);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <div className="flex items-center gap-3 text-gray-600">
          <span className="font-semibold text-gray-800">PDF</span>
          {busy && (
            <span className="flex items-center gap-1.5 text-blue-600">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              Converting…
            </span>
          )}
          {!busy && time !== null && <span>{Math.round(time)} ms</span>}
          {!busy && bytes && <span>{(bytes.byteLength / 1024).toFixed(1)} KB</span>}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={!bytes}
          className="cursor-pointer rounded bg-orange-500 px-3 py-1 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Download
        </button>
      </div>
      {error && (
        <pre className="m-0 whitespace-pre-wrap border-b border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</pre>
      )}
      <div className="min-h-[480px] flex-1 bg-gray-100">
        {url ? (
          <embed src={url} type="application/pdf" className="h-full min-h-[480px] w-full border-0" />
        ) : (
          <div className="flex h-full min-h-[480px] items-center justify-center text-sm text-gray-500">
            {busy ? "Converting…" : "The PDF appears here."}
          </div>
        )}
      </div>
    </div>
  );
};
