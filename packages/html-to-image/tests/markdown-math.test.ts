import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { markdownToHtml } from "../src/markdown";
import { katexCss, katexMath } from "../src/markdown-math";
import { KATEX_CSS_VERSION, KATEX_FONT_FACES, KATEX_RULES } from "../src/katex-css";

/** The tokens the renderer got, shown as <m>tex</m> / <m d>tex</m> (display). */
const fake = { render: (tex: string, display: boolean) => `<m${display ? " d" : ""}>${tex}</m>`, css: "/*fake*/" };
/** `math` null means no renderer at all (an omitted argument would pick the fake one). */
const body = (md: string, math: typeof fake | null = fake) =>
  /<article class="markdown-body">([\s\S]*)<\/article>/.exec(
    markdownToHtml(md, { ...(math ? { math } : {}), highlight: false }),
  )![1].trim();

describe("math syntax", () => {
  it("typesets $...$ inline and keeps the TeX as written", () => {
    expect(body(String.raw`Euler: $e^{i\pi}+1=0$ done`)).toBe(String.raw`<p>Euler: <m>e^{i\pi}+1=0</m> done</p>`);
    expect(body("$a$ and $b$")).toBe("<p><m>a</m> and <m>b</m></p>");
    expect(body("$a_1 + a_2$")).toBe("<p><m>a_1 + a_2</m></p>"); // not emphasis
  });

  it("leaves prices, spaced dollars, escaped dollars and code alone", () => {
    expect(body("It costs $5 and $10 total")).toBe("<p>It costs $5 and $10 total</p>");
    expect(body("a $ b $ c")).toBe("<p>a $ b $ c</p>");
    expect(body(String.raw`cost \$5 here`)).toBe("<p>cost $5 here</p>");
    expect(body("use `$x$` literally")).toBe("<p>use <code>$x$</code> literally</p>");
    expect(body("```\n$x$\n```")).toContain("<code>$x$\n</code>");
  });

  it("typesets $$ blocks, on their own lines or in one line", () => {
    expect(body(String.raw`$$
\frac{a}{b}
$$`)).toBe(String.raw`<div class="math-display"><m d>\frac{a}{b}</m></div>`);
    expect(body("$$x^2$$")).toBe('<div class="math-display"><m d>x^2</m></div>');
    expect(body("before\n\n$$\na+b\n$$\n\nafter")).toBe(
      '<p>before</p>\n<div class="math-display"><m d>a+b</m></div>\n<p>after</p>',
    );
  });

  it("is off without a math renderer, and adds the renderer's stylesheet when on", () => {
    expect(body("$x$", null)).toBe("<p>$x$</p>");
    expect(markdownToHtml("$x$", { math: fake })).toContain("/*fake*/");
  });

  it("shows the TeX with an error title when the renderer throws, instead of failing the page", () => {
    const html = body("$bad$", { render: () => { throw new Error("boom"); }, css: "" });
    expect(html).toBe('<p><code class="math-error" title="Error: boom">bad</code></p>');
  });
});

describe("katexMath", () => {
  it("renders KaTeX HTML (not MathML) for inline and display maths", () => {
    const m = katexMath();
    const inline = m.render(String.raw`x^2`, false);
    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain("<math");
    expect(inline).not.toContain("katex-display");
    expect(m.render(String.raw`\frac{a}{b}`, true)).toContain("katex-display");
  });

  it("throws on invalid TeX so the page shows the source (see math syntax above)", () => {
    expect(() => katexMath().render(String.raw`\notacommand{`, false)).toThrow();
    const html = markdownToHtml(String.raw`$\notacommand{$ ok`, { math: katexMath() });
    expect(html).toContain("math-error");
  });

  it("serves the fonts from the given base, one woff2 per face", () => {
    const css = katexCss("https://fonts.example/k");
    expect(css).toContain("src:url(https://fonts.example/k/KaTeX_Main-Regular.woff2) format(\"woff2\")");
    expect((css.match(/@font-face/g) ?? []).length).toBe(KATEX_FONT_FACES.length);
    expect(css).not.toMatch(/\.ttf|\.woff[^2]/);
    expect(katexCss()).toContain(`katex@${KATEX_CSS_VERSION}/dist/fonts/`);
    expect(KATEX_RULES).toContain(".katex");
  });

  it("is built from the installed katex: the generated stylesheet is current", async () => {
    // Re-run `node scripts/gen-katex-css.mjs` when katex is upgraded.
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("../node_modules/katex/package.json", import.meta.url)), "utf8"),
    );
    expect(KATEX_CSS_VERSION).toBe(pkg.version);
  });

  it("runs with nothing but katex and marked, so it works in browsers and Workers", () => {
    const source = fs.readFileSync(fileURLToPath(new URL("../src/markdown-math.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.every((m) => m === "katex" || m.startsWith("./"))).toBe(true);
    expect(source).not.toMatch(/\bprocess\.|\brequire\(|node:/);
  });
});
