import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropCachedModule,
  loadHtmlToImageModule,
  loadPrecompiledModule,
  type CreateHtmlToImageModule,
  type EmscriptenModuleArg,
  type HtmlToImageModule,
} from "../src/loader.js";
import { checkWasmBinary } from "../src/wasm-binary.js";

/** Header-only module: valid, but no sections. */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** One exported-less type section (`func () -> ()`). */
const TYPED_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section
]);

/** One function import from the namespace "env". */
const IMPORTING_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
  0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x00, 0x00, // import section
]);

const fakeModule = (tag: string): HtmlToImageModule =>
  ({ tag }) as unknown as HtmlToImageModule;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dropCachedModule();
});

describe("wasm-binary: checkWasmBinary", () => {
  it("accepts a complete module", () => {
    const check = checkWasmBinary(TYPED_WASM);
    expect(check.ok).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("accepts a header-only module", () => {
    expect(checkWasmBinary(EMPTY_WASM).ok).toBe(true);
  });

  it("rejects a truncated module with the section that runs past the end", () => {
    // Cut the type section in half: its declared size no longer fits.
    const truncated = TYPED_WASM.subarray(0, TYPED_WASM.length - 2);
    const check = checkWasmBinary(truncated);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("extends past end of the module");
    expect(check.reason).toContain("Type");
  });

  it("rejects bytes that are not a WebAssembly binary", () => {
    const check = checkWasmBinary(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("not a WebAssembly binary");
  });

  it("reports the import namespaces of the binary", () => {
    expect(checkWasmBinary(IMPORTING_WASM).namespaces).toEqual(["env"]);
    expect(checkWasmBinary(TYPED_WASM).namespaces).toEqual([]);
  });
});

describe("loader: parallel initialization", () => {
  it("instantiates once for concurrent loads with the same key", async () => {
    const mod = fakeModule("one");
    let calls = 0;
    const factory = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return mod;
    }) as unknown as CreateHtmlToImageModule;
    const moduleArg: EmscriptenModuleArg = { locateFile: () => "" };

    const results = await Promise.all(
      [1, 2, 3, 4].map(() => loadHtmlToImageModule({ factory, moduleArg })),
    );

    expect(calls).toBe(1);
    for (const r of results) expect(r).toBe(mod);
  });

  it("reuses the cached module for later loads", async () => {
    const mod = fakeModule("cached");
    const factory = vi.fn(async () => mod) as unknown as CreateHtmlToImageModule;
    const moduleArg: EmscriptenModuleArg = { locateFile: () => "" };

    const first = await loadHtmlToImageModule({ factory, moduleArg });
    const second = await loadHtmlToImageModule({ factory, moduleArg });

    expect(first).toBe(mod);
    expect(second).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load, so the next call retries", async () => {
    const mod = fakeModule("retry");
    const factory = vi
      .fn<[], Promise<HtmlToImageModule>>()
      .mockRejectedValueOnce(new Error("boot failed"))
      .mockResolvedValueOnce(mod) as unknown as CreateHtmlToImageModule;
    const moduleArg: EmscriptenModuleArg = { locateFile: () => "" };

    await expect(
      loadHtmlToImageModule({ factory, moduleArg }),
    ).rejects.toThrow("boot failed");
    const retried = await loadHtmlToImageModule({ factory, moduleArg });
    expect(retried).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("loader: corrupt / mismatched artifacts", () => {
  it("retries once when the engine reports a CompileError", async () => {
    const mod = fakeModule("recovered");
    const factory = vi
      .fn<[], Promise<HtmlToImageModule>>()
      .mockRejectedValueOnce(
        new WebAssembly.CompileError("section Data extends past end"),
      )
      .mockResolvedValueOnce(mod) as unknown as CreateHtmlToImageModule;
    const moduleArg: EmscriptenModuleArg = { locateFile: () => "" };

    const loaded = await loadHtmlToImageModule({ factory, moduleArg });
    expect(loaded).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not retry a glue/binary mismatch and explains it", async () => {
    const failure = new TypeError('Import #0 "env" is not an object');
    const factory = vi.fn(async () => {
      throw failure;
    }) as unknown as CreateHtmlToImageModule;
    const moduleArg: EmscriptenModuleArg = { locateFile: () => "" };

    await expect(
      loadHtmlToImageModule({ factory, moduleArg }),
    ).rejects.toThrow(/do not match/);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("rejects a truncated wasmBinary before the factory is called", async () => {
    const factory = vi.fn(async () => fakeModule("never")) as unknown as
      CreateHtmlToImageModule;
    const truncated = TYPED_WASM.subarray(0, TYPED_WASM.length - 2);

    await expect(
      loadHtmlToImageModule({
        factory,
        moduleArg: { wasmBinary: truncated },
      }),
    ).rejects.toThrow(/extends past end of the module/);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("loader: precompiled module failures", () => {
  it("rejects instead of hanging when the instantiation fails", async () => {
    const wasm = {} as unknown as WebAssembly.Module;
    const failure = new TypeError('Import #0 "env" is not an object');
    vi.spyOn(WebAssembly, "instantiate").mockRejectedValue(failure);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The glue only offers a success callback: the factory promise stays
    // pending, exactly like the real emscripten glue does.
    const factory = vi.fn(
      async (arg: EmscriptenModuleArg) =>
        new Promise<HtmlToImageModule>(() => {
          (arg.instantiateWasm as (i: unknown, cb: unknown) => unknown)(
            {},
            () => {},
          );
        }),
    ) as unknown as CreateHtmlToImageModule;

    await expect(
      loadPrecompiledModule(
        factory,
        wasm,
        new Map<WebAssembly.Module, Promise<HtmlToImageModule>>(),
        "workerd",
      ),
    ).rejects.toThrow('Import #0 "env" is not an object');
  });
});
