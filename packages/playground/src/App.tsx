import React, { useState, useEffect } from "react";
import { HtmlPlayground } from "./HtmlPlayground";
import { ImagePlayground } from "./ImagePlayground";

export const App: React.FC = () => {
  const [tab, setTab] = useState<"html" | "image">(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    return mode === "image" ? "image" : "html";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentMode = params.get("mode");
    if (tab === "image" && currentMode !== "image") {
      params.set("mode", "image");
      const url = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", url);
    } else if (tab === "html" && currentMode) {
      params.delete("mode");
      const url = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
      window.history.replaceState({}, "", url);
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap justify-between items-center sticky top-0 z-50 shadow-xs">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-blue-600 tracking-tight">
            wasm-html-to-image
          </h1>
          <nav className="flex gap-2 bg-gray-100 p-1 rounded-lg border border-gray-200 text-sm font-medium">
            <button
              onClick={() => setTab("html")}
              className={`px-4 py-1.5 rounded-md transition-colors cursor-pointer ${
                tab === "html"
                  ? "bg-white text-blue-600 font-semibold shadow-xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              HTML to Image
            </button>
            <button
              onClick={() => setTab("image")}
              className={`px-4 py-1.5 rounded-md transition-colors cursor-pointer ${
                tab === "image"
                  ? "bg-white text-blue-600 font-semibold shadow-xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Image Optimization
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href="https://github.com/SoraKumo001/wasm-html-to-image"
            target="_blank"
            rel="noreferrer"
            className="text-gray-600 hover:text-blue-600 transition-colors"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {tab === "html" ? <HtmlPlayground /> : <ImagePlayground />}
      </main>
    </div>
  );
};

export default App;
