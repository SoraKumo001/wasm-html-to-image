import { describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

const withPage = (html: string, use: (w: any) => void) => {
  const dom = new JSDOM(html, { virtualConsole: null });
  try {
    use(dom.window);
  } finally {
    dom.close();
  }
};

describe("cached reads follow the page", () => {
  it("getAttribute / hasAttribute / matches after host writes", () => {
    withPage("<!doctype html><body><div id=a class=x><button type=button>go</button></div>", (w) => {
      const b = w.document.querySelector("button");
      for (let i = 0; i < 3; i++) {
        expect(b.getAttribute("type")).toBe("button");
        expect(b.hasAttribute("disabled")).toBe(false);
        expect(b.matches("[disabled]")).toBe(false);
        expect(b.matches("div")).toBe(false);
      }
      b.setAttribute("disabled", "");
      b.setAttribute("type", "submit");
      expect(b.getAttribute("type")).toBe("submit");
      expect(b.hasAttribute("disabled")).toBe(true);
      expect(b.matches("[disabled]")).toBe(true);
    });
  });

  it("and after the page's own code changes things", () => {
    withPage("<!doctype html><body><p id=p>x</p>", (w) => {
      const p = w.document.getElementById("p");
      expect(p.getAttribute("title")).toBe(null);
      expect(p.getAttribute("title")).toBe(null);
      w.eval(`document.getElementById("p").setAttribute("title", "t")`);
      expect(p.getAttribute("title")).toBe("t");
      expect(p.closest("body").tagName).toBe("BODY");
      w.eval(`document.getElementById("p").remove()`);
      expect(p.closest("body")).toBe(null);
      expect(p.parentNode).toBe(null);
    });
  });

  it("structural reads (parentNode, firstChild, siblings) after tree changes", () => {
    withPage("<!doctype html><body><ul><li id=a>a</li><li id=b>b</li></ul>", (w) => {
      const d = w.document;
      const ul = d.querySelector("ul");
      const a = d.getElementById("a");
      const b = d.getElementById("b");
      for (let i = 0; i < 2; i++) {
        expect(a.parentNode).toBe(ul);
        expect(ul.firstChild).toBe(a);
        expect(ul.lastChild).toBe(b);
        expect(a.nextSibling).toBe(b);
        expect(b.previousSibling).toBe(a);
      }
      ul.insertBefore(b, a);
      expect(ul.firstChild).toBe(b);
      expect(ul.lastChild).toBe(a);
      expect(a.previousSibling).toBe(b);
      expect(b.nextSibling).toBe(a);
      ul.removeChild(a);
      expect(a.parentNode).toBe(null);
      expect(ul.lastChild).toBe(b);
      const style = (b as any).style;
      expect(b.style).toBe(style);
      b.style.color = "red";
      expect(b.style).toBe(style);
      expect(b.style.color).toBe("red");
    });
  });

  it("a property the wrapper has that reads as undefined is still undefined, not the page's", () => {
    withPage("<!doctype html><body><p id=p>x</p>", (w) => {
      const p = w.document.getElementById("p");
      (p as any).mine = undefined;
      expect((p as any).mine).toBeUndefined();
      expect("mine" in p).toBe(true);
      expect((p as any).nothing).toBeUndefined();
    });
  });
});
