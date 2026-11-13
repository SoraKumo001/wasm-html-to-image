import { afterEach, describe, expect, it } from "vitest";
import {
  dropCachedModule,
  getDefaultModule,
  render,
  setModuleRecyclePolicy,
} from "../src/single.js";

afterEach(() => {
  setModuleRecyclePolicy(undefined);
  dropCachedModule();
});

const page = { value: "<p>recycle</p>", width: 120, format: "png" } as const;

describe("module recycle policy", () => {
  it("keeps the instance when no policy is set", async () => {
    const first = await getDefaultModule();
    await render(page);
    await render(page);
    expect(await getDefaultModule()).toBe(first);
  });

  it("replaces the instance after the configured number of renders", async () => {
    setModuleRecyclePolicy({ everyRenders: 2 });
    const first = await getDefaultModule();
    await render(page);
    expect(await getDefaultModule()).toBe(first);
    await render(page);
    expect(await getDefaultModule()).not.toBe(first);
    // The fresh instance renders normally.
    const out = await render(page);
    expect((out.data as Uint8Array).length).toBeGreaterThan(0);
  });

  it("replaces the instance when the Wasm heap passes the configured size", async () => {
    setModuleRecyclePolicy({ maxHeapBytes: 1 });
    const first = await getDefaultModule();
    await render(page);
    expect(await getDefaultModule()).not.toBe(first);
  });
});
