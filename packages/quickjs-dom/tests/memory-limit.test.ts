import { describe, expect, it } from "vitest";
import { createDOM, runPageScriptsQuickJS } from "../src/index.js";

// A page that tries to keep ~64 MB of strings alive and reports how far it got in the DOM.
const GREEDY = `<!doctype html><body><div id="a">unset</div><script>
  try {
    const chunks = [];
    let total = 0;
    while (total < 64 * 1024 * 1024) {
      const s = "x".repeat(1024 * 1024);
      chunks.push(s);
      total += s.length;
    }
    document.getElementById("a").textContent = "allocated";
  } catch (e) {
    document.getElementById("a").textContent = "failed";
  }
</script></body>`;

describe("memoryLimit option", () => {
  // The serialized page also carries the script's own source, so the marker is matched as element text.
  it("lets a greedy page allocate under the default limit", async () => {
    const out = await runPageScriptsQuickJS({ html: GREEDY }, { settleMs: 0 });
    expect(out.html).toContain(">allocated<");
  });

  it("stops the same page at a small limit instead of growing without bound", async () => {
    // Over the limit, QuickJS fails the allocations; a promise chain the page is waiting on may never
    // settle after a hard out-of-memory, so the script phase ends at its (here shortened) timeout with
    // the DOM as it was — bounded, and the isolate survives, where an uncapped page would grow the
    // Wasm memory until the host killed the whole isolate.
    const out = await runPageScriptsQuickJS(
      { html: GREEDY },
      { settleMs: 0, timeout: 2000, memoryLimit: 4 * 1024 * 1024 },
    );
    expect(out.html).not.toContain(">allocated<");
  });

  it("still runs ordinary pages under a small limit", async () => {
    const dom = await createDOM(
      { html: `<!doctype html><body><p id="x">a</p></body>` },
      { memoryLimit: 4 * 1024 * 1024 },
    );
    try {
      const out = await dom.eval(`document.getElementById("x").textContent = "b"; document.body.innerHTML.length`);
      expect(typeof out).toBe("number");
      expect(dom.serialize()).toContain(">b<");
    } finally {
      dom.close();
    }
  });

  it("refuses a negative limit", async () => {
    await expect(createDOM({ html: "<p>x</p>" }, { memoryLimit: -1 })).rejects.toThrow(/memoryLimit/);
  });
});
