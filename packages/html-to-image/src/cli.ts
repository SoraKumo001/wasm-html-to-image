#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { render, type OutputFormat } from "./single.js";
import { buildRenderOptions, isUrlInput, type CliFlags } from "./cli-options.js";

const OUTPUT_FORMATS = [
  "svg",
  "png",
  "pdf",
  "jpeg",
  "webp",
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
  .argument("<input>", "input HTML/image file path or URL")
  .option("-o, --output <path>", "output file path")
  .option("-w, --width <number>", "viewport width", (v) => parseInt(v, 10), 800)
  .option("-h, --height <number>", "viewport height (omit for auto)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "-f, --format <format>",
    `output format (${OUTPUT_FORMATS.join(", ")})`,
    "png",
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
    "--animation <duration-ms>",
    "sample the document's @keyframes opacity / transform / color animation into an animated WebP; one loop duration in ms (webp output only)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-fps <n>",
    "animation frame rate (default 15, capped at ~75 frames total; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-loop <n>",
    "how many times the animated WebP repeats (0 = infinite, the default; 1 = play once; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .action(async (input: string, options: CliFlags) => {
    try {
      const format = String(options.format).toLowerCase();
      if (!isOutputFormat(format)) {
        console.error(
          `Error: unsupported format "${options.format}". Choose from: ${OUTPUT_FORMATS.join(", ")}`,
        );
        process.exit(1);
      }

      const isUrl = isUrlInput(input);

      let outputPath: string | undefined = options.output;
      if (!outputPath) {
        const ext = format;
        outputPath = isUrl
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
        animation: options.animation,
        animationFps: options.animationFps,
        animationLoop: options.animationLoop,
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
