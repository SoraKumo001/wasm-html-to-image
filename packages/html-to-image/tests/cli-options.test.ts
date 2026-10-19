import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRenderOptions,
  isUrlInput,
  type CliFlags,
} from "../src/cli-options.js";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/cli-input.html", import.meta.url),
);

const flags = (overrides: Partial<CliFlags> = {}): CliFlags => ({
  width: 800,
  format: "png",
  quality: 85,
  ...overrides,
});

describe("cli options", () => {
  it("treats schemes as URLs but Windows paths and data: URLs as files/values", () => {
    expect(isUrlInput("https://example.com/news")).toBe(true);
    expect(isUrlInput("http://127.0.0.1:8080/base/final.html")).toBe(true);
    expect(isUrlInput("C:\\pages\\template.html")).toBe(false);
    expect(isUrlInput("template.html")).toBe(false);
    expect(isUrlInput("data:image/png;base64,AAAA")).toBe(false);
  });

  it("leaves baseUrl unset for URL input so the post-redirect URL wins", async () => {
    const options = await buildRenderOptions(
      "https://old.example/news/",
      flags(),
    );
    expect(options.url).toBe("https://old.example/news/");
    expect(options).not.toHaveProperty("baseUrl");
    expect(options).not.toHaveProperty("value");
  });

  it("pins an explicit --base-url for URL input", async () => {
    const options = await buildRenderOptions(
      "https://old.example/news/",
      flags({ baseUrl: "https://explicit.example/base/" }),
    );
    expect(options.url).toBe("https://old.example/news/");
    expect(options.baseUrl).toBe("https://explicit.example/base/");
  });

  it("bases a file input on its own directory", async () => {
    const options = await buildRenderOptions(FIXTURE, flags());
    expect(options.value).toContain("cli fixture");
    expect(options.baseUrl).toBe(path.dirname(FIXTURE));
  });

  it("lets an explicit --base-url override a file input's directory", async () => {
    const options = await buildRenderOptions(
      FIXTURE,
      flags({ baseUrl: "/srv/assets" }),
    );
    expect(options.value).toContain("cli fixture");
    expect(options.baseUrl).toBe("/srv/assets");
  });
});
