import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanvasPath2D,
  createCanvas,
  htmlToImage,
  loadHtmlToImageModule,
} from "wasm-html-to-image";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "output");
fs.mkdirSync(outDir, { recursive: true });

const mod = await loadHtmlToImageModule();

// 1. Render an HTML badge/header into PNG bytes using Satoru
const htmlResult = await htmlToImage(mod, {
  value: `
    <div style="font-family: sans-serif; color: #f8fafc; padding: 16px 24px; background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(255,255,255,0.2); border-radius: 14px;">
      <div style="font-size: 13px; letter-spacing: 0.08em; color: #38bdf8; font-weight: 700;">WASM-HTML-TO-IMAGE</div>
      <div style="font-size: 28px; font-weight: 800; margin-top: 6px;">2D Canvas + HTML Compositing</div>
      <div style="font-size: 14px; color: #cbd5e1; margin-top: 4px;">Powered by Skia CPU Rasterizer in WebAssembly</div>
    </div>
  `,
  width: 720,
  format: "png",
});

// 2. Create an 800x450 2D Canvas and draw shapes, gradients, shadows, and paths
const canvas = createCanvas(mod, 800, 450);
try {
  const ctx = canvas.getContext("2d");

  // Background linear gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 800, 450);
  bgGrad.addColorStop(0, "#0f172a");
  bgGrad.addColorStop(0.5, "#1e293b");
  bgGrad.addColorStop(1, "#090d16");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 800, 450);

  // Decorative radial glow
  const glow = ctx.createRadialGradient(640, 320, 10, 640, 320, 220);
  glow.addColorStop(0, "rgba(56, 189, 248, 0.45)");
  glow.addColorStop(1, "rgba(56, 189, 248, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(420, 100, 400, 350);

  // Dashed grid lines
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (let x = 40; x < 800; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 450);
    ctx.stroke();
  }
  ctx.restore();

  // Elevated card with shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
  ctx.beginPath();
  ctx.roundRect(40, 190, 720, 220, 18);
  ctx.fill();
  ctx.restore();

  // Stroke border on card
  ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(40, 190, 720, 220, 18);
  ctx.stroke();

  // Draw a star emblem using CanvasPath2D (SVG path string)
  ctx.save();
  ctx.translate(130, 300);
  ctx.scale(1.6, 1.6);
  const star = new CanvasPath2D(
    "M 0 -40 L 11 -12 L 40 -12 L 17 6 L 26 34 L 0 17 L -26 34 L -17 6 L -40 -12 L -11 -12 Z",
  );
  const starGrad = ctx.createLinearGradient(-40, -40, 40, 40);
  starGrad.addColorStop(0, "#38bdf8");
  starGrad.addColorStop(1, "#818cf8");
  ctx.fillStyle = starGrad;
  ctx.fill(star);
  ctx.restore();

  // Draw a simple bar chart using rounded bars
  const bars = [
    { h: 120, color: "#38bdf8" },
    { h: 85, color: "#818cf8" },
    { h: 150, color: "#34d399" },
    { h: 110, color: "#f472b6" },
    { h: 140, color: "#fbbf24" },
  ];
  bars.forEach((bar, i) => {
    const bx = 260 + i * 90;
    const by = 380 - bar.h;
    ctx.fillStyle = bar.color;
    ctx.beginPath();
    ctx.roundRect(bx, by, 54, bar.h, [8, 8, 2, 2]);
    ctx.fill();
  });

  // Composite the HTML-rendered header onto the Canvas
  if (htmlResult.data instanceof Uint8Array) {
    ctx.drawImage(htmlResult.data, 40, 30);
  }

  // Export to PNG and WebP
  const pngOut = canvas.encode({ format: "png" });
  const webpOut = canvas.encode({ format: "webp", quality: 90 });

  fs.writeFileSync(path.join(outDir, "card.png"), pngOut);
  fs.writeFileSync(path.join(outDir, "card.webp"), webpOut);

  console.log(
    `Generated output/card.png (${pngOut.length} bytes) and output/card.webp (${webpOut.length} bytes)`,
  );
} finally {
  canvas.dispose();
}
