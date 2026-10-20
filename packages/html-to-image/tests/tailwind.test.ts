import { describe, expect, it, vi } from "vitest";
import { convertTw, createCSS, tailwind } from "../src/tailwind";

describe("convertTw", () => {
  it("turns tw into class and merges with an existing class", () => {
    expect(convertTw('<div tw="flex gap-2">x</div>')).toBe(
      '<div class="flex gap-2">x</div>',
    );
    expect(convertTw('<div class="a" id="i" tw="b c"></div>')).toBe(
      '<div id="i" class="a b c"></div>',
    );
    expect(convertTw("<img tw='w-4' src='a.png' />")).toBe(
      '<img src=\'a.png\' class="w-4" />',
    );
  });

  it("leaves markup without tw, comments, script and style content alone", () => {
    const html =
      '<p class="x">a</p><!-- <i tw="no"> --><script>var s = \'<b tw="no">\'</script><style>i[tw="no"]{}</style>';
    expect(convertTw(html)).toBe(html);
  });
});

describe("createCSS", () => {
  it("generates utilities for class tokens (unchanged behaviour)", async () => {
    const css = await createCSS('<div class="flex"></div>');
    expect(css).toMatch(/\.flex\s*\{[^}]*display:\s*flex/);
  });

  it("expands @theme into :root variables and maps --color-* onto utilities", async () => {
    const css = await createCSS('<div class="bg-brand"></div>', {
      css: "@theme { --color-brand: #ff0000; --radius-card: 12px; }",
    });
    expect(css).toMatch(/:root\s*\{[^}]*--color-brand:#ff0000/);
    expect(css).toMatch(/--radius-card:12px/);
    expect(css).toMatch(/\.bg-brand\s*\{[^}]*var\(--colors-brand\)/);
    expect(css).not.toContain("@theme");
  });

  it("expands @apply from options.css and from <style> blocks, warning for unknown utilities", async () => {
    const warn = vi.fn();
    const html =
      '<style>.card { @apply flex items-center; color: red; }</style><div class="card"></div>';
    const css = await createCSS(html, {
      css: ".btn { @apply font-bold not-a-utility; }",
      warn,
    });
    expect(css).toMatch(/\.card\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*color:\s*red/);
    expect(css).toMatch(/\.btn\s*\{[^}]*font-weight:\s*var\(--fontWeight-bold\)/);
    expect(css).not.toContain("@apply");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("not-a-utility");
  });
});

describe("tailwind", () => {
  it("returns html with tw converted and the css for it", async () => {
    const { html, css } = await tailwind('<div tw="flex bg-brand"></div>', {
      css: "@theme { --color-brand: #00ff00 }",
    });
    expect(html).toBe('<div class="flex bg-brand"></div>');
    expect(css).toMatch(/\.flex\s*\{/);
    expect(css).toMatch(/--color-brand:#00ff00/);
  });
});
