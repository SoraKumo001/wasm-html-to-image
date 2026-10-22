import { afterEach, describe, expect, it, vi } from "vitest";
import { precompiledModuleArg } from "../src/loader.js";

const fakeWasm = (): WebAssembly.Module =>
  ({}) as unknown as WebAssembly.Module;

afterEach(() => {
  vi.restoreAllMocks();
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
});
