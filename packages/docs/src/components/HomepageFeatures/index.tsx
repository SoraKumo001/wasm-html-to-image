import type { ReactNode } from "react";
import Heading from "@theme/Heading";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const jaFeatureList: FeatureItem[] = [
  {
    title: "単一 WASM モジュール統合",
    icon: "⚡",
    description: (
      <>
        <strong>Satoru</strong>（HTMLレイアウト・描画）と{" "}
        <strong>wasm-image-optimization</strong>（画像変換・最適化）を1つの
        Emscripten
        モジュールに統合。メモリとプロセスのオーバーヘッドを最小化します。
      </>
    ),
  },
  {
    title: "多彩な入出力フォーマット",
    icon: "🎨",
    description: (
      <>
        HTML 文字列・URL に加え、画像バイナリを直接入力可能。出力は
        SVG、PNG、JPEG、WebP、AVIF、RAW、ThumbHash、さらに複数ページ対応 PDF
        まで幅広くカバーします。
      </>
    ),
  },
  {
    title: "ゼロコンフィグの Single 版",
    icon: "🚀",
    description: (
      <>
        <code>wasm-html-to-image/single</code> をインポートするだけで、WASM
        ファイルの配備や初期化コードなしに即座に <code>render()</code>{" "}
        を実行可能。Node.js やバンドラ環境で極めて容易に使えます。
      </>
    ),
  },
  {
    title: "Cloudflare & Edge 対応",
    icon: "🌐",
    description: (
      <>
        <code>wasm-html-to-image/workerd</code> および <code>edge-light</code>{" "}
        サブパスを提供。ヘッドレスブラウザが動作しないエッジワーカー環境でも高速・低メモリで
        OGP 画像生成が可能です。
      </>
    ),
  },
  {
    title: "並列 Worker プール",
    icon: "🧵",
    description: (
      <>
        <code>wasm-html-to-image/workers</code> により、Node.js の{" "}
        <code>worker_threads</code> や Web Worker
        を用いたマルチスレッド並列処理を標準サポート。大量バッチ生成でもイベントループをブロックしません。
      </>
    ),
  },
  {
    title: "React / Preact / Tailwind 連携",
    icon: "⚛️",
    description: (
      <>
        React / Preact コンポーネントの直接描画（JSX support）や、UnoCSS
        ベースの Tailwind
        ユーティリティクラスによるインラインスタイリングをシームレスに実現します。
      </>
    ),
  },
];

const enFeatureList: FeatureItem[] = [
  {
    title: "Single Unified WASM Module",
    icon: "⚡",
    description: (
      <>
        Combines <strong>Satoru</strong> (HTML layout & rendering) and{" "}
        <strong>wasm-image-optimization</strong> (image conversion & encoding)
        into a single Emscripten binary, minimizing memory and overhead.
      </>
    ),
  },
  {
    title: "Versatile Input & Output Formats",
    icon: "🎨",
    description: (
      <>
        Accepts HTML strings, URLs, or raw image buffers. Generates SVG, PNG,
        JPEG, WebP, AVIF, RAW, ThumbHash, and multi-page PDF files with ease.
      </>
    ),
  },
  {
    title: "Zero-Config Single Bundle",
    icon: "🚀",
    description: (
      <>
        Import <code>wasm-html-to-image/single</code> and call{" "}
        <code>render()</code> immediately without worrying about WASM asset
        paths or manual initialization.
      </>
    ),
  },
  {
    title: "Cloudflare Workers & Edge Ready",
    icon: "🌐",
    description: (
      <>
        Dedicated <code>workerd</code> and <code>edge-light</code> exports
        enable fast, lightweight OGP and banner generation even in constrained
        serverless edge runtimes.
      </>
    ),
  },
  {
    title: "Multi-Threaded Worker Pool",
    icon: "🧵",
    description: (
      <>
        Built-in <code>wasm-html-to-image/workers</code> support provides
        parallel batch processing across Node.js worker threads and Web Workers
        without blocking the main event loop.
      </>
    ),
  },
  {
    title: "React, Preact & Tailwind Integration",
    icon: "⚛️",
    description: (
      <>
        Render React / Preact JSX components directly and apply modern
        utility-first CSS layouts using the integrated UnoCSS/Tailwind pipeline.
      </>
    ),
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <div className="feature-card">
      <div className="feature-icon-wrapper">
        <span>{icon}</span>
      </div>
      <Heading as="h3" className="feature-title">
        {title}
      </Heading>
      <p className="feature-description">{description}</p>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  const { i18n } = useDocusaurusContext();
  const featureList =
    i18n.currentLocale === "en" ? enFeatureList : jaFeatureList;

  return (
    <section className="features-section">
      <div className="features-grid">
        {featureList.map((props, idx) => (
          <Feature key={idx} {...props} />
        ))}
      </div>
    </section>
  );
}
