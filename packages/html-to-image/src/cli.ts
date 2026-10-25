#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { render, type OutputFormat } from "./single.js";
import {
  buildRenderOptions,
  inferFormat,
  isInlineHtml,
  isUrlInput,
  type CliFlags,
} from "./cli-options.js";

const OUTPUT_FORMATS = [
  "svg",
  "png",
  "pdf",
  "jpeg",
  "webp",
  "apng",
  "gif",
  "tiff",
  "avif",
  "jxl",
  "raw",
  "thumbhash",
  "none",
] as const;

function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

program
  .name("wasm-html-to-image")
  .description(
    "HTML to image converter on the single unified WASM module (svg/pdf direct, png/jpeg/webp/avif/jxl/raw/thumbhash via encode or html_to_image)",
  )
  .version("0.1.0")
  .argument("<input>", "input HTML/image file path, URL, inline HTML string (starts with <), or - for stdin")
  .option("-o, --output <path>", "output file path")
  .option("-w, --width <number>", "viewport width", (v) => parseInt(v, 10), 800)
  .option("-h, --height <number>", "viewport height (omit for auto)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "-f, --format <format>",
    `output format (${OUTPUT_FORMATS.join(", ")}); default: from the --output extension, else png`,
  )
  .option(
    "--font <path>",
    "local font file or glob such as './fonts/*.woff2' (repeatable); 'Family=path' registers it under that family name, e.g. 'Segoe UI=C:/Windows/Fonts/segoeui.ttf'",
    (v: string, prev: string[] = []) => [...prev, v],
  )
  .option(
    "-q, --quality <number>",
    "encode quality 0-100 (encode stage only)",
    (v) => parseFloat(v),
    85,
  )
  .option(
    "--base-url <url>",
    "base URL for relative resources (URL input: defaults to the post-redirect document URL; file input: defaults to the file's directory)",
  )
  .option(
    "--color-space <srgb|cmyk>",
    "output color space of tiff and pdf (default srgb; cmyk rewrites colors for print, with no ICC profile)",
    (v) => v.toLowerCase(),
  )
  .option(
    "--scale <n>",
    "pixel density of raster output from HTML (default 1; 3.125 draws an 800px layout as 2500px)",
    (v) => parseFloat(v),
  )
  .option(
    "--dpi <n>",
    "resolution written to tiff output, in pixels per inch (default 96 x scale)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation <duration-ms>",
    "sample the document's @keyframes opacity / transform / color animation into an animated WebP / APNG / GIF; one loop duration in ms (webp, apng and gif output only; the CSS animation-duration wins and this value is an upper bound)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-fps <n>",
    "animation frame rate (default 15, capped at ~75 frames total; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-loop <n>",
    "how many times the animated WebP / APNG / GIF repeats (0 = infinite, the default; 1 = play once; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .action(async (input: string, options: CliFlags) => {
    try {
      const format = String(
        options.format ?? inferFormat(options.output) ?? "png",
      ).toLowerCase();
      if (!isOutputFormat(format)) {
        console.error(
          `Error: unsupported format "${options.format}". Choose from: ${OUTPUT_FORMATS.join(", ")}`,
        );
        process.exit(1);
      }

      if (
        options.colorSpace !== undefined &&
        options.colorSpace !== "srgb" &&
        options.colorSpace !== "cmyk"
      ) {
        console.error(
          `Error: unsupported color space "${options.colorSpace}". Choose from: srgb, cmyk`,
        );
        process.exit(1);
      }

      const isUrl = isUrlInput(input);
      const isVirtual = isInlineHtml(input) || input === "-";
      if (isVirtual && !options.output) {
        console.error("Error: --output is required for inline HTML or stdin input");
        process.exit(1);
      }

      let outputPath: string | undefined = options.output;
      if (!outputPath) {
        const ext = format;
        outputPath = isUrl || isVirtual
          ? `output.${ext}`
          : path.format({
              dir: path.dirname(input),
              name: path.basename(input, path.extname(input)),
              ext: `.${ext}`,
            });
      }

      const flags: CliFlags = {
        output: options.output,
        width: options.width,
        height: options.height,
        format,
        quality: options.quality,
        baseUrl: options.baseUrl,
        colorSpace: options.colorSpace,
        scale: options.scale,
        dpi: options.dpi,
        animation: options.animation,
        animationFps: options.animationFps,
        animationLoop: options.animationLoop,
        font: options.font,
      };

      const result = await render(await buildRenderOptions(input, flags));
      await fs.writeFile(
        outputPath,
        typeof result.data === "string"
          ? result.data
          : Buffer.from(result.data),
      );
      console.log(`Successfully rendered to ${outputPath}`);
    } catch (err) {
      console.error("Error during rendering:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
