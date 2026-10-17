import { render } from "wasm-html-to-image/single";
import fs from "node:fs";
const html = `<html><body style="margin:0"><div style="writing-mode:vertical-rl;height:300px;font-size:20px;font-family:'Noto Sans JP'">吾輩は猫である。名前はまだ無い。「こんにちは」ABC 123</div></body></html>`;
const t = Date.now();
const r = await render({ value: html, width: 400, format: "png" });
fs.writeFileSync("vertical/out/smoke.png", Buffer.from(r.data));
console.log("ok", r.data.byteLength, Date.now() - t, "ms");
