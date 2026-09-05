#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { render, type HtmlToImageOptions, type OutputFormat } from "./single.js";

const OUTPUT_FORMATS = [
  "svg",
  "png",
  "pdf",
  "jpeg",
  "webp",
  "avif",
  "raw",
  "thumbhash",
] as const;

function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

program
  .name("wasm-html-to-image")
  .description(
    "HTML to image converter on the single unified WASM module (svg/pdf direct, png/jpeg/webp/avif/raw/thumbhash via encode or html_to_image)",
  )
  .version("0.1.0")
  .argument("<input>", "input HTML file path or URL")
  .option("-o, --output <path>", "output file path")
  .option("-w, --width <number>", "viewport width", (v) => parseInt(v, 10), 800)
  .option(
    "-h, --height <number>",
    "viewport height (omit for auto)",
    (v) => parseInt(v, 10),
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
  .action(async (input: string, options) => {
    try {
      const format = String(options.format).toLowerCase();
      if (!isOutputFormat(format)) {
        console.error(
          `Error: unsupported format "${options.format}". Choose from: ${OUTPUT_FORMATS.join(", ")}`,
        );
        process.exit(1);
      }

      const isUrl =
        /^[a-z][a-z0-9+.-]*:/i.test(input) && !input.startsWith("data:");

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

      const renderOptions: HtmlToImageOptions = {
        width: options.width,
        height: options.height,
        format,
        quality: options.quality,
        ...(isUrl
          ? { url: input, baseUrl: input }
          : {
              value: await fs.readFile(input, "utf-8"),
              baseUrl: path.dirname(path.resolve(input)),
            }),
      };

      const result = await render(renderOptions);
      await fs.writeFile(
        outputPath,
        typeof result === "string" ? result : Buffer.from(result),
      );
      console.log(`Successfully rendered to ${outputPath}`);
    } catch (err) {
      console.error("Error during rendering:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
