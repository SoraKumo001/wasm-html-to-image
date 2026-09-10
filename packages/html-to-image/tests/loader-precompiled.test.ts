import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropCachedModule,
  loadPrecompiledModule,
  precompiledModuleArg,
  type CreateHtmlToImageModule,
  type HtmlToImageModule,
} from "../src/loader.js";

const fakeModule = (tag: string): HtmlToImageModule =>
  ({ tag }) as unknown as HtmlToImageModule;
const fakeWasm = (): WebAssembly.Module =>
  ({}) as unknown as WebAssembly.Module;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dropCachedModule();
});

describe("loader: precompiledModuleArg", () => {
  it("returns an emscripten arg whose instantiateWasm resolves via callback", async () => {
    const wasm = fakeWasm();
    const arg = precompiledModuleArg(wasm, "workerd");
    expect(typeof arg.instantiateWasm).toBe("function");
    const instance = { tag: "instance" };
    const instantiate = vi
      .spyOn(WebAssembly, "instantiate")
      .mockResolvedValue(instance as never);
    const success = vi.fn();
    const ret = (
      arg.instantiateWasm as (
        imports: unknown,
        cb: unknown,
      ) => unknown
    )({ imports: true }, success);
    expect(ret).toEqual({});
    await vi.waitFor(() => {
      expect(success).toHaveBeenCalledWith(instance, wasm);
    });
    expect(instantiate).toHaveBeenCalledWith(wasm, { imports: true });
  });

  it("logs the label on instantiation failure", async () => {
    const wasm = fakeWasm();
    const arg = precompiledModuleArg(wasm, "edge-light");
    const failure = new Error("nope");
    vi.spyOn(WebAssembly, "instantiate").mockRejectedValue(failure);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const success = vi.fn();
    (
      arg.instantiateWasm as (
        imports: unknown,
        cb: unknown,
      ) => unknown
    )({}, success);
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        "wasm-html-to-image [edge-light]: Wasm instantiation failed:",
        failure,
      );
    });
    expect(success).not.toHaveBeenCalled();
  });
});

describe("loader: loadPrecompiledModule per-wasm cache", () => {
  it("reuses the module for the same wasm", async () => {
    const mod = fakeModule("one");
    const factory = vi.fn(async () => mod);
    const cache = new Map<
      WebAssembly.Module,
      Promise<HtmlToImageModule>
    >();
    const wasm = fakeWasm();
    const first = await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      wasm,
      cache,
      "workerd",
    );
    const second = await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      wasm,
      cache,
      "workerd",
    );
    expect(first).toBe(mod);
    expect(second).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not share modules across different wasm binaries", async () => {
    let n = 0;
    const factory = vi.fn(async () => fakeModule(`m${++n}`));
    const cache = new Map<
      WebAssembly.Module,
      Promise<HtmlToImageModule>
    >();
    const a = await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      fakeWasm(),
      cache,
      "workerd",
    );
    const b = await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      fakeWasm(),
      cache,
      "edge-light",
    );
    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("evicts failed loads so the next call retries", async () => {
    const mod = fakeModule("retry");
    const factory = vi
      .fn<[], Promise<HtmlToImageModule>>()
      .mockRejectedValueOnce(new Error("boot failed"))
      .mockResolvedValueOnce(mod);
    const cache = new Map<
      WebAssembly.Module,
      Promise<HtmlToImageModule>
    >();
    const wasm = fakeWasm();
    await expect(
      loadPrecompiledModule(
        factory as unknown as CreateHtmlToImageModule,
        wasm,
        cache,
        "workerd",
      ),
    ).rejects.toThrow("boot failed");
    expect(cache.has(wasm)).toBe(false);
    const retried = await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      wasm,
      cache,
      "workerd",
    );
    expect(retried).toBe(mod);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("hands the instantiateWasm adapter to the factory", async () => {
    const mod = fakeModule("args");
    let seen: unknown;
    const factory = vi.fn(async (arg: unknown) => {
      seen = arg;
      return mod;
    });
    const wasm = fakeWasm();
    await loadPrecompiledModule(
      factory as unknown as CreateHtmlToImageModule,
      wasm,
      new Map(),
      "workerd",
    );
    expect(factory).toHaveBeenCalledTimes(1);
    const moduleArg = (seen as { instantiateWasm?: unknown } | undefined)
      ?.instantiateWasm;
    expect(typeof moduleArg).toBe("function");
  });
});
