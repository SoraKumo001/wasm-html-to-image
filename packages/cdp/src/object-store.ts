/**
 * Guest-side script injected into QuickJS to manage CDP RemoteObjects (`objectId`),
 * `Runtime.evaluate`, `Runtime.callFunctionOn`, `Runtime.getProperties`, and `Runtime.releaseObject`.
 */
export const GUEST_CDP_RUNTIME_SCRIPT = `
(function (g) {
  if (g.__cdp) return;
  var objects = new Map();
  var groups = new Map();
  var nodeIds = new WeakMap();
  var nodesByBackendId = new Map();
  var nextId = 1;
  var nextNodeId = 1;
  var nextExceptionId = 1;

  function backendIdOf(el) {
    var id = nodeIds.get(el);
    if (!id) {
      id = nextNodeId++;
      nodeIds.set(el, id);
      nodesByBackendId.set(id, el);
    }
    return id;
  }

  function store(val, objectGroup) {
    var id = "obj-" + (nextId++);
    objects.set(id, val);
    if (objectGroup) {
      var set = groups.get(objectGroup);
      if (!set) {
        set = new Set();
        groups.set(objectGroup, set);
      }
      set.add(id);
    }
    return id;
  }

  function detectSubtype(val) {
    if (val === null) return "null";
    if (Array.isArray(val)) return "array";
    if (typeof g.Node === "function" && val instanceof g.Node) return "node";
    if (val instanceof Error) return "error";
    if (val instanceof RegExp) return "regexp";
    if (val instanceof Date) return "date";
    if (typeof Map === "function" && val instanceof Map) return "map";
    if (typeof Set === "function" && val instanceof Set) return "set";
    if (typeof Promise === "function" && val instanceof Promise) return "promise";
    if (ArrayBuffer.isView(val)) return "typedarray";
    if (val instanceof ArrayBuffer) return "arraybuffer";
    return undefined;
  }

  function toRemoteObject(val, returnByValue, objectGroup) {
    if (val === undefined) return { type: "undefined" };
    if (val === null) return { type: "object", subtype: "null", value: null };
    var t = typeof val;
    if (t === "boolean" || t === "string") return { type: t, value: val };
    if (t === "number") {
      if (Number.isNaN(val)) return { type: "number", unserializableValue: "NaN", description: "NaN" };
      if (val === Infinity) return { type: "number", unserializableValue: "Infinity", description: "Infinity" };
      if (val === -Infinity) return { type: "number", unserializableValue: "-Infinity", description: "-Infinity" };
      if (Object.is(val, -0)) return { type: "number", unserializableValue: "-0", description: "-0" };
      return { type: "number", value: val, description: String(val) };
    }
    if (t === "bigint") {
      return { type: "bigint", unserializableValue: String(val) + "n", description: String(val) + "n" };
    }
    if (t === "symbol") {
      return { type: "symbol", description: String(val) };
    }
    if (returnByValue) {
      // QuickJS host bridge already JSON-serializes the return value of dom.eval,
      // so verify JSON-serializability to surface circular reference errors like CDP.
      var encoded = JSON.stringify(val);
      return { type: t, value: encoded === undefined ? undefined : JSON.parse(encoded) };
    }
    var subtype = detectSubtype(val);
    var className = t === "function" ? "Function" : (val.constructor && val.constructor.name) || "Object";
    var description = className;
    if (subtype === "node") {
      description = val.nodeName ? String(val.nodeName).toLowerCase() : "node";
    } else if (subtype === "error") {
      description = val.stack || (val.name + ": " + val.message);
    } else if (t === "function") {
      description = "function " + (val.name || "") + "() {}";
    }
    return {
      type: t,
      subtype: subtype,
      className: className,
      description: description,
      objectId: store(val, objectGroup)
    };
  }

  function makeExceptionDetails(err) {
    var text = err instanceof Error ? (err.message || String(err)) : String(err);
    return {
      exceptionId: nextExceptionId++,
      text: "Uncaught " + text,
      lineNumber: 0,
      columnNumber: 0,
      exception: toRemoteObject(err, false)
    };
  }

  function resolveArg(arg) {
    if (!arg) return undefined;
    if ("objectId" in arg && arg.objectId !== undefined) {
      if (!objects.has(arg.objectId)) throw new Error("Could not find object with given id: " + arg.objectId);
      return objects.get(arg.objectId);
    }
    if ("unserializableValue" in arg && arg.unserializableValue !== undefined) {
      var u = arg.unserializableValue;
      if (u === "NaN") return NaN;
      if (u === "Infinity") return Infinity;
      if (u === "-Infinity") return -Infinity;
      if (u === "-0") return -0;
      if (u === "undefined") return undefined;
      if (u.endsWith("n")) return BigInt(u.slice(0, -1));
    }
    return arg.value;
  }

  g.__cdp = {
    evaluate: async function (params) {
      try {
        var val = (0, eval)(params.expression);
        if (params.awaitPromise) val = await val;
        return { result: toRemoteObject(val, !!params.returnByValue, params.objectGroup) };
      } catch (err) {
        return {
          result: toRemoteObject(err, false),
          exceptionDetails: makeExceptionDetails(err)
        };
      }
    },
    callFunctionOn: async function (params) {
      try {
        var fn = (0, eval)("(" + params.functionDeclaration + ")");
        if (typeof fn !== "function") throw new TypeError("functionDeclaration did not evaluate to a function");
        var thisArg = g;
        if (params.objectId !== undefined) {
          if (!objects.has(params.objectId)) {
            return {
              result: { type: "undefined" },
              exceptionDetails: makeExceptionDetails(new Error("Could not find object with given id"))
            };
          }
          thisArg = objects.get(params.objectId);
        }
        var args = Array.isArray(params.arguments) ? params.arguments.map(resolveArg) : [];
        var val = fn.apply(thisArg, args);
        if (params.awaitPromise) val = await val;
        return { result: toRemoteObject(val, !!params.returnByValue, params.objectGroup) };
      } catch (err) {
        return {
          result: toRemoteObject(err, false),
          exceptionDetails: makeExceptionDetails(err)
        };
      }
    },
    getProperties: function (params) {
      var obj = objects.get(params.objectId);
      if (obj === undefined && !objects.has(params.objectId)) {
        return { result: [] };
      }
      var names = params.ownProperties ? Object.getOwnPropertyNames(obj) : Object.keys(obj);
      var result = [];
      for (var i = 0; i < names.length; i++) {
        var k = names[i];
        var desc = Object.getOwnPropertyDescriptor(obj, k);
        if (!desc) continue;
        result.push({
          name: k,
          value: "value" in desc ? toRemoteObject(desc.value, false) : undefined,
          writable: !!desc.writable,
          configurable: !!desc.configurable,
          enumerable: !!desc.enumerable,
          isOwn: Object.prototype.hasOwnProperty.call(obj, k)
        });
      }
      return { result: result };
    },
    releaseObject: function (objectId) {
      objects.delete(objectId);
    },
    releaseObjectGroup: function (objectGroup) {
      var set = groups.get(objectGroup);
      if (!set) return;
      set.forEach(function (id) { objects.delete(id); });
      groups.delete(objectGroup);
    },
    getObject: function (objectId) {
      return objects.get(objectId);
    },
    toRemoteObject: toRemoteObject,
    getContentQuads: function (objectId) {
      var el = objects.get(objectId);
      if (!el || typeof el.getBoundingClientRect !== "function") return { quads: [] };
      var r = el.getBoundingClientRect();
      if (!(r.width > 0 || r.height > 0)) return { quads: [] };
      return {
        quads: [[r.left, r.top, r.right, r.top, r.right, r.bottom, r.left, r.bottom]]
      };
    },
    getBoxModel: function (objectId) {
      var el = objects.get(objectId);
      if (!el || typeof el.getBoundingClientRect !== "function") {
        throw new Error("Could not compute box model.");
      }
      var r = el.getBoundingClientRect();
      var q = [r.left, r.top, r.right, r.top, r.right, r.bottom, r.left, r.bottom];
      return {
        model: {
          content: q,
          padding: q,
          border: q,
          margin: q,
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      };
    },
    describeNode: function (objectId) {
      var el = objects.get(objectId);
      if (!el) throw new Error("Could not find node with given id");
      var attrs = [];
      if (el.attributes) {
        for (var i = 0; i < el.attributes.length; i++) {
          attrs.push(el.attributes[i].name, el.attributes[i].value);
        }
      }
      var bid = backendIdOf(el);
      return {
        node: {
          nodeId: bid,
          backendNodeId: bid,
          nodeType: el.nodeType || 1,
          nodeName: el.nodeName || "DIV",
          localName: el.localName || (el.tagName ? el.tagName.toLowerCase() : ""),
          nodeValue: el.nodeValue || "",
          childNodeCount: el.childNodes ? el.childNodes.length : 0,
          attributes: attrs
        }
      };
    },
    resolveNode: function (params) {
      var el = params && params.backendNodeId !== undefined
        ? nodesByBackendId.get(params.backendNodeId)
        : (params && params.objectId ? objects.get(params.objectId) : undefined);
      if (!el) throw new Error("No node with given id found");
      return { object: toRemoteObject(el, false, params && params.objectGroup) };
    },
    dispatchMouseEvent: function (params) {
      var x = Number(params.x || 0);
      var y = Number(params.y || 0);
      var el = (typeof g.document.elementFromPoint === "function" ? g.document.elementFromPoint(x, y) : null)
        || g.document.body || g.document.documentElement;
      if (!el) return;
      var btn = params.button === "right" ? 2 : params.button === "middle" ? 1 : 0;
      var opts = {
        bubbles: true,
        cancelable: true,
        view: g,
        clientX: x,
        clientY: y,
        button: btn,
        detail: params.clickCount || 1
      };
      if (params.type === "mouseMoved") {
        el.dispatchEvent(new g.MouseEvent("mousemove", opts));
      } else if (params.type === "mousePressed") {
        el.dispatchEvent(new g.MouseEvent("mousedown", opts));
        var focusable = typeof el.closest === "function"
          ? el.closest("input,textarea,select,button,a[href],[tabindex]")
          : el;
        if (focusable && typeof focusable.focus === "function") focusable.focus();
        else if (typeof el.focus === "function") el.focus();
      } else if (params.type === "mouseReleased") {
        el.dispatchEvent(new g.MouseEvent("mouseup", opts));
        if (btn === 0) {
          if (typeof el.click === "function") el.click();
          else el.dispatchEvent(new g.MouseEvent("click", opts));
        }
      }
    },
    dispatchKeyEvent: function (params) {
      var target = g.document.activeElement || g.document.body || g.document.documentElement;
      if (!target) return;
      var key = params.key || "";
      var text = params.text || "";
      var evInit = {
        bubbles: true,
        cancelable: true,
        view: g,
        key: key,
        code: params.code || "",
        keyCode: params.windowsVirtualKeyCode || 0
      };
      var hasValueProp = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (params.type === "keyDown" || params.type === "rawKeyDown") {
        var ok = target.dispatchEvent(new g.KeyboardEvent("keydown", evInit));
        if (ok) {
          var ch = text && text !== "\\r" && text !== "\\n" ? text : (key.length === 1 ? key : "");
          if (ch) {
            target.dispatchEvent(new g.KeyboardEvent("keypress", evInit));
            if (hasValueProp) {
              target.value = String(target.value == null ? "" : target.value) + ch;
              target.dispatchEvent(new g.Event("input", { bubbles: true }));
            }
          } else if (key === "Backspace" && hasValueProp) {
            var v = String(target.value == null ? "" : target.value);
            if (v.length > 0) {
              target.value = v.slice(0, -1);
              target.dispatchEvent(new g.Event("input", { bubbles: true }));
            }
          } else if (key === "Enter") {
            target.dispatchEvent(new g.KeyboardEvent("keypress", evInit));
            if (hasValueProp) target.dispatchEvent(new g.Event("change", { bubbles: true }));
          }
        }
      } else if (params.type === "keyUp") {
        target.dispatchEvent(new g.KeyboardEvent("keyup", evInit));
      } else if (params.type === "char" && text) {
        target.dispatchEvent(new g.KeyboardEvent("keypress", evInit));
        if (hasValueProp) {
          target.value = String(target.value == null ? "" : target.value) + text;
          target.dispatchEvent(new g.Event("input", { bubbles: true }));
        }
      }
    },
    insertText: function (params) {
      var target = g.document.activeElement || g.document.body || g.document.documentElement;
      if (!target) return;
      var text = params.text || "";
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        target.value = String(target.value == null ? "" : target.value) + text;
        target.dispatchEvent(new g.Event("input", { bubbles: true }));
      }
    }
  };

  // Hook <a href> clicks and location navigation for CDP navigation events
  if (g.document && typeof g.document.addEventListener === "function") {
    g.document.addEventListener("click", function (ev) {
      if (ev.defaultPrevented) return;
      var t = ev.target;
      var anchor = t && typeof t.closest === "function" ? t.closest("a[href]") : null;
      if (!anchor) return;
      var href = anchor.getAttribute("href");
      if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
      if (typeof g.__cdp_navigate === "function") {
        try {
          g.__cdp_navigate(new g.URL(href, g.location.href).href);
        } catch (e) {}
      }
    });
  }
  if (g.location) {
    g.location.assign = function (u) {
      if (typeof g.__cdp_navigate === "function") {
        g.__cdp_navigate(new g.URL(String(u), g.location.href).href);
      }
    };
    g.location.replace = function (u) {
      if (typeof g.__cdp_navigate === "function") {
        g.__cdp_navigate(new g.URL(String(u), g.location.href).href);
      }
    };
    g.location.reload = function () {
      if (typeof g.__cdp_reload === "function") g.__cdp_reload();
    };
    var p = g.location, hrefDesc = null;
    while (p && !hrefDesc) {
      hrefDesc = Object.getOwnPropertyDescriptor(p, "href");
      p = Object.getPrototypeOf(p);
    }
    if (hrefDesc && hrefDesc.get) {
      Object.defineProperty(g.location, "href", {
        configurable: true,
        enumerable: true,
        get: function () { return hrefDesc.get.call(this); },
        set: function (v) {
          var next = new g.URL(String(v), g.location.href).href;
          if (hrefDesc.set) hrefDesc.set.call(this, next);
          if (typeof g.__cdp_navigate === "function") g.__cdp_navigate(next);
        }
      });
    }
  }
})(globalThis);
`;
