// Generates focused vertical-writing cases into vertical/cases/*.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases");

const FONT = "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese";
const head = () => `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:400;src:url(${FONT}-400-normal.woff2) format('woff2');}
@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:700;src:url(${FONT}-700-normal.woff2) format('woff2');}
body{margin:0;padding:12px;font-family:'Noto Sans JP',sans-serif;font-size:16px;line-height:1.6;background:#fff;color:#111}
.v{writing-mode:vertical-rl}.l{writing-mode:vertical-lr}
.f{border:1px solid #888;background:#f3f4f6}
.row{display:flex;gap:16px;align-items:flex-start}
</style></head><body>`;
const tail = "</body></html>";
const N =
  "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。";
const svg = (w: number, h: number, inner: string) =>
  `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${inner}</svg>`;

const cases: Record<string, string> = {
  "01-basic-rl": `<div class="v f" style="height:260px">${N}</div>`,
  "02-basic-lr": `<div class="l f" style="height:260px">${N}</div>`,
  "03-punct": `<div class="v f" style="height:300px">「こんにちは！」、彼は言った。（括弧）『二重』〈山括弧〉【隅付き】…三点リーダー―ダッシュ～波ダッシュ・中黒：コロン；セミコロン？疑問！感嘆ー長音ぁぃゃょっ小書き</div>`,
  "04-latin-mixed": `<div class="v f" style="height:300px">日本語 English words and ABC-123 mixed、数字2024年 と URL http://a.b/c?d=1 の混在。</div>`,
  "05-orientation": `<div class="row"><div class="v f" style="height:200px;text-orientation:mixed">mixed: ABC あいう 123</div><div class="v f" style="height:200px;text-orientation:upright">upright: ABC あいう 123</div><div class="v f" style="height:200px;text-orientation:sideways">sideways: ABC あいう 123</div></div>`,
  "06-tcy": `<div class="v f" style="height:260px">第<span style="text-combine-upright:all">21</span>世紀。<span style="text-combine-upright:all">2024</span>年<span style="text-combine-upright:all">12</span>月<span style="text-combine-upright:all">31</span>日。<span style="text-combine-upright:digits 2">12345</span>と<span style="text-combine-upright:all">ABCD</span></div>`,
  "07-ruby": `<div class="v f" style="height:260px;font-size:20px;line-height:2"><ruby>吾輩<rt>わがはい</rt></ruby>は<ruby>猫<rt>ねこ</rt></ruby>である。<ruby>名前<rt>なまえ</rt></ruby>はまだ<ruby>無<rt>な</rt></ruby>い。</div>`,
  "08-multicolumn-wrap": `<div class="v f" style="height:160px;width:500px">${N}${N}</div>`,
  "09-shrink-width": `<div class="row"><div class="v f" style="height:200px">${N}</div><div class="l f" style="height:200px">${N}</div></div>`,
  "10-box-model": `<div class="v" style="height:300px"><div style="border:3px solid #3b82f6;padding:10px 4px 20px 30px;margin:5px 20px 15px 8px;background:#eff6ff">padding/margin/border の論理方向テスト。${N}</div></div>`,
  "11-fixed-size": `<div class="v f" style="height:200px;width:120px;overflow:hidden">${N}${N}</div>`,
  "12-text-align": `<div class="row"><div class="v f" style="height:200px;text-align:start">start 先頭揃え</div><div class="v f" style="height:200px;text-align:center">center 中央揃え</div><div class="v f" style="height:200px;text-align:end">end 末尾揃え</div><div class="v f" style="height:200px;text-align:justify">justify 両端揃えのテスト。${N}</div></div>`,
  "13-indent": `<div class="v f" style="height:220px;text-indent:2em">字下げのテスト。${N}</div>`,
  "14-decoration": `<div class="row"><div class="v f" style="height:200px"><span style="text-decoration:underline">下線 underline</span><br><span style="text-decoration:overline">上線 overline</span><br><span style="text-decoration:line-through">打消 line-through</span></div><div class="v f" style="height:200px;text-emphasis:filled sesame">圏点 emphasis を付ける</div><div class="v f" style="height:200px"><span style="text-decoration:underline wavy red">波線 wavy</span> <span style="text-decoration:underline dotted blue">点線 dotted</span></div></div>`,
  "15-inline-bg": `<div class="v f" style="height:260px;font-size:18px">通常<span style="background:#fde68a;padding:2px 4px;border:1px solid #f59e0b;border-radius:4px">背景付きのインライン</span>通常<b>太字のテキスト</b>と<i>斜体 italic</i>と<span style="font-size:28px">大きな文字</span>と<small>小さな文字</small>。</div>`,
  "16-spacing": `<div class="row"><div class="v f" style="height:260px;letter-spacing:0.3em">字間 letter-spacing</div><div class="v f" style="height:260px;line-height:2.5">行間が広い line-height ${N}</div><div class="v f" style="height:260px;word-spacing:1em">word spacing a b c あ い う</div></div>`,
  "17-kinsoku": `<div class="v f" style="height:114px">これは禁則処理のテストです。「閉じ括弧」が行頭に来ないこと、（開き括弧）が行末に来ないこと、句点。読点、小書きゃゅょっ、長音ー、が行頭に来ないことを確認します。</div>`,
  "18-inline-block": `<div class="v f" style="height:260px">前<span style="display:inline-block;width:40px;height:40px;background:#f87171;vertical-align:top"></span>中<span style="display:inline-block;border:2px solid #3b82f6;padding:4px">inline-block 内の文</span>後<span style="display:inline-block;width:30px;height:60px;background:#34d399"></span>終</div>`,
  "19-images": `<div class="v f" style="height:260px">前<img src="${svg(40, 40, "<rect width='40' height='40' fill='orange'/><circle cx='20' cy='20' r='12' fill='navy'/>")}" width="40" height="40">後ろ。画像が行内に入る場合の確認。<img src="${svg(30, 60, "<rect width='30' height='60' fill='teal'/>")}" width="30" height="60" style="vertical-align:middle">終</div>`,
  "20-list": `<div class="row"><ul class="v f" style="height:220px"><li>りんご</li><li>みかん</li><li>ぶどう</li></ul><ol class="v f" style="height:220px"><li>第一項目</li><li>第二項目</li><li>第三項目</li></ol><ol class="l f" style="height:220px;list-style:cjk-ideographic"><li>壱</li><li>弐</li><li>参</li></ol></div>`,
  "21-headings-blocks": `<div class="v f" style="height:320px"><h1 style="margin:0 0 0 12px">見出し1</h1><h2 style="margin:0 0 0 12px">見出し2</h2><p style="margin:0 12px">段落1。${N}</p><p style="margin:0 12px">段落2。短い。</p><blockquote style="margin:0 12px;border-inline-start:4px solid #888;padding-inline-start:8px">引用文。ブロッククォート。</blockquote></div>`,
  "22-table": `<div class="v f" style="height:300px"><table border="1" style="border-collapse:collapse"><tr><th>項目</th><th>値</th></tr><tr><td>名前</td><td>吾輩</td></tr><tr><td>種別</td><td>猫である</td></tr></table></div><br><table border="1" style="border-collapse:collapse"><tr><td class="v" style="height:100px">縦書きセル</td><td class="l" style="height:100px">縦書きLR</td><td>横書き</td></tr></table>`,
  "23-flex-in-vertical": `<div class="v f" style="height:220px;width:400px;display:flex;gap:10px"><div style="background:#bfdbfe;flex:1">flex 子1 ${N}</div><div style="background:#fecaca;flex:2">flex 子2 ${N}</div></div>`,
  "24-flex-column-vertical": `<div class="v f" style="height:260px;width:320px;display:flex;flex-direction:column;gap:8px"><div style="background:#bfdbfe">A 子1</div><div style="background:#fecaca;flex:1">B 子2 flex1 ${N}</div><div style="background:#bbf7d0">C 子3</div></div>`,
  "25-flex-center": `<div class="v f" style="height:260px;width:300px;display:flex;justify-content:center;align-items:center"><div style="background:#fff;border:1px solid #3b82f6;padding:8px">中央 center</div></div>`,
  "26-horizontal-in-vertical": `<div class="v f" style="height:300px">縦<div style="writing-mode:horizontal-tb;border:1px solid #3b82f6;padding:4px;margin:8px;width:150px">横書きのブロックが縦書きの中に入る。折り返しも確認する。</div>縦に戻る。</div>`,
  "27-vertical-in-horizontal": `<div class="f" style="width:400px">横書きの段落の中に<span class="v" style="display:inline-block;height:100px;border:1px solid #3b82f6;vertical-align:top">縦書きinline-block</span>が入る。続きの横書きテキストがここに入る。</div>`,
  "28-nested-vertical": `<div class="v f" style="height:260px"><div class="l" style="border:1px solid #3b82f6;margin:8px;height:120px">LRの入れ子 ${N}</div>外側RLの文。${N}</div>`,
  "29-abs-pos": `<div class="v f" style="height:240px;width:300px;position:relative"><div style="position:absolute;top:10px;right:10px;background:#fecaca">top/right</div><div style="position:absolute;bottom:10px;left:10px;background:#bfdbfe">bottom/left</div>本文。${N}</div>`,
  "30-float": `<div class="v f" style="height:240px;width:300px"><div style="float:right;width:60px;height:60px;background:#fecaca;margin:4px">F</div>フロートの回り込み。${N}${N}</div>`,
  "31-br-pre-nowrap": `<div class="row"><div class="v f" style="height:200px">一行目<br>二行目<br><br>四行目</div><pre class="v f" style="height:200px;margin:0">pre 整形済み
  インデント
三行目 ABC</pre><div class="v f" style="height:200px;white-space:nowrap">nowrap で折り返さない長い長い長い長い長い長い長い文章</div></div>`,
  "32-overflow-wrap": `<div class="v f" style="height:150px;width:140px;overflow-wrap:anywhere">ThisIsAVeryLongEnglishWordWithoutSpacesToWrapAnywhere 日本語もちゃんと続く。</div>`,
  "33-bg-radius-shadow": `<div class="v" style="height:200px;background:linear-gradient(90deg,#fde68a,#93c5fd);border:3px solid #333;border-radius:20px;padding:12px;box-shadow:6px 6px 0 #999">グラデーション背景と角丸、影。${N}</div>`,
  "34-transform": `<div class="v f" style="height:200px;transform:rotate(8deg);margin:30px;width:fit-content">回転 rotate。${N}</div>`,
  "35-opacity-clip": `<div class="v f" style="height:180px;opacity:.6;overflow:hidden;width:100px">半透明とクリップ。${N}</div>`,
  "36-stroke-shadow": `<div class="v f" style="height:260px;font-size:28px;font-weight:700;-webkit-text-stroke:1px #c00;text-shadow:2px 2px 2px #888">縁取りと影 stroke shadow</div>`,
  "37-line-clamp": `<div class="v f" style="height:200px;width:110px;overflow:hidden">ここは行数制限（line-clamp）の確認。${N}</div>`,
  "38-font-sizes": `<div class="row"><div class="v f" style="height:260px;font-size:12px">12px 小さい文字。${N}</div><div class="v f" style="height:260px;font-size:24px">24px 大きい文字。${N}</div><div class="v f" style="height:260px;font-size:40px;font-weight:700">40px 太字</div></div>`,
  "39-vertical-align": `<div class="v f" style="height:260px;font-size:18px">基準<span style="font-size:10px;vertical-align:super">上付</span>文字<sub>下付</sub>と<span style="vertical-align:middle;font-size:30px">中央</span>と<span style="vertical-align:text-top;font-size:10px">text-top</span>。</div>`,
  "40-logical-props": `<div class="v" style="height:260px"><div style="inline-size:200px;block-size:120px;margin-inline:10px;margin-block:20px;padding-inline:8px;padding-block:4px;border-inline-start:6px solid #3b82f6;background:#eff6ff">logical props ${N}</div></div>`,
  "41-min-max-size": `<div class="v f" style="height:200px;max-height:200px;min-width:100px">${N}</div>`,
  "42-percent-height": `<div style="height:300px"><div class="v f" style="height:100%;width:100px">${N}</div></div>`,
  "43-inline-elements": `<div class="v f" style="height:260px"><a href="#" style="color:#2563eb;text-decoration:underline">リンクテキスト</a>と<code style="background:#ddd">code</code>と<mark>mark</mark>と<kbd>kbd</kbd>。</div>`,
  "44-full-article": `<div class="v" style="height:420px;width:760px;padding:16px;background:#fffbeb;border:1px solid #d6b656;font-size:18px;line-height:1.9"><h1 style="font-size:28px;margin:0 0 0 16px">吾輩は猫である</h1><p style="margin:0 0 0 16px;font-size:14px">夏目漱石</p><p style="margin:0;text-indent:1em">${N}${N}</p><p style="margin:0;text-indent:1em">吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番<ruby>獰悪<rt>どうあく</rt></ruby>な種族であったそうだ。第<span style="text-combine-upright:all">1</span>章、<span style="text-combine-upright:all">2024</span>年。</p></div>`,
  // --- isolation of suspected bugs ---
  "50-deco-underline-only": `<div class="v f" style="height:200px"><span style="text-decoration:underline">下線 underline</span></div>`,
  "51-deco-linethrough-only": `<div class="v f" style="height:200px"><span style="text-decoration:line-through">打消 line-through</span></div>`,
  "52-deco-block-level": `<div class="v f" style="height:200px;text-decoration:underline">ブロックに下線 ${N}</div>`,
  "53-deco-br": `<div class="v f" style="height:200px">一行目<br><span style="text-decoration:underline">下線二行目</span><br>三行目</div>`,
  "54-inline-block-simple": `<div class="v f" style="height:200px"><span style="display:inline-block;border:2px solid #3b82f6;padding:4px">ib 内の文</span></div>`,
  "55-inline-block-nofixed": `<div class="v f" style="height:200px;width:200px">前<span style="display:inline-block;width:40px;height:40px;background:#f87171"></span>後</div>`,
  "56-indent-block-p": `<div class="v f" style="height:200px"><p style="margin:0;text-indent:1em">段落の字下げ。${N}</p></div>`,
  "57-tcy-two-digits": `<div class="v f" style="height:200px"><span style="text-combine-upright:all">21</span>と<span style="text-combine-upright:all">99</span>と<span style="text-combine-upright:all">7</span></div>`,
  "58-letter-spacing-latin": `<div class="v f" style="height:200px;letter-spacing:6px">字間6px あいうえお ABC</div>`,
  // --- other situations ---
  "60-body-vertical": `<style>body{writing-mode:vertical-rl;height:300px;width:760px}</style><p>${N}</p><p>二段落目。${N}</p>`,
  "61-html-vertical": `<style>html{writing-mode:vertical-rl;height:300px}body{width:760px}</style><p>${N}</p>`,
  "62-pseudo": `<style>.p::before{content:"【前】";color:#c00}.p::after{content:"【後】";color:#00c}.p::first-letter{font-size:2em;color:#080}</style><div class="v f p" style="height:260px">吾輩は猫である。名前はまだ無い。</div>`,
  "63-grid": `<div class="v f" style="height:240px;width:360px;display:grid;grid-template-columns:1fr 2fr;gap:8px"><div style="background:#bfdbfe">格子1 ${N}</div><div style="background:#fecaca">格子2 ${N}</div></div>`,
  "64-emoji-symbols": `<div class="v f" style="height:260px">絵文字😀🐱と記号★☆♪→←↑↓※〒。ABC</div>`,
  "65-direction-rtl": `<div class="v f" style="height:240px;direction:rtl">direction:rtl 先頭が下になる。${N}</div>`,
  "66-sideways": `<div class="row"><div class="f" style="height:200px;writing-mode:sideways-rl">sideways-rl あいう ABC</div><div class="f" style="height:200px;writing-mode:sideways-lr">sideways-lr あいう ABC</div><div class="v f" style="height:200px;writing-mode:horizontal-tb;width:120px">horizontal-tb 上書き</div></div>`,
  "67-split-inline-border": `<div class="v f" style="height:100px;width:200px">前置き<span style="border:2px solid #3b82f6;background:#dbeafe;padding:2px;border-radius:6px">長いインライン要素が複数の列にまたがって折り返される場合の枠線と背景</span>後置き</div>`,
  "68-text-orientation-upright-cjk": `<div class="v f" style="height:240px;text-orientation:upright">縦中横なしの upright。ABC123 abc。${N}</div>`,
  "69-overflow-scroll-clip": `<div class="v f" style="height:100px;width:100px;overflow:hidden;border-radius:12px">${N}${N}</div>`,
  "70-very-long-latin": `<div class="v f" style="height:200px;width:90px">Supercalifragilisticexpialidocious_antidisestablishmentarianism</div>`,
  "71-bg-clip-text": `<div class="v f" style="height:240px;font-size:32px;font-weight:700;background:linear-gradient(180deg,#f43f5e,#3b82f6);-webkit-background-clip:text;color:transparent;background-clip:text">グラデ文字</div>`,
  "72-ellipsis": `<div class="v f" style="height:120px;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">省略記号の確認。${N}</div>`,
  "73-lh-mixed-fonts": `<div class="v f" style="height:260px;font-family:serif">明朝・serif のフォント。<span style="font-family:monospace">monospace ABC</span>とgeneric。</div>`,
  "74-table-vertical-only": `<table class="v" border="1" style="border-collapse:collapse;height:200px"><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table>`,
  "75-table-horizontal-cells-vertical": `<table border="1" style="border-collapse:collapse"><tr><td class="v" style="height:120px">縦セルA</td><td class="v" style="height:120px">縦セルB長め長め</td></tr></table>`,
  "76-float-horizontal-control": `<div class="f" style="width:300px"><div style="float:right;width:60px;height:60px;background:#fecaca">F</div>${N}</div>`,
  "77-float-left-vertical": `<div class="v f" style="height:240px;width:300px"><div style="float:left;width:60px;height:60px;background:#fecaca;margin:4px">F</div>${N}${N}</div>`,
  "78-ul-marker-inside": `<ul class="v f" style="height:200px;list-style-position:inside"><li>りんご</li><li>みかん</li></ul>`,
  "79-ruby-horizontal-control": `<div class="f" style="width:300px;font-size:20px;line-height:2"><ruby>吾輩<rt>わがはい</rt></ruby>は猫である。</div>`,
  "79b-ruby-compound-h": `<div class="f" style="width:600px;font-size:20px;line-height:2"><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>と<ruby>東<rt>とう</rt>京<rt>きょう</rt></ruby>と<ruby>猫<rt>ねこ</rt></ruby>。</div>`,
  "79c-ruby-compound-v": `<div class="v f" style="height:300px;font-size:20px;line-height:2"><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>と<ruby>東<rt>とう</rt>京<rt>きょう</rt></ruby>と<ruby>猫<rt>ねこ</rt></ruby>。</div>`,
  "79d-ruby-rtc": `<div class="f" style="width:600px;font-size:20px;line-height:2"><ruby><rbc>漢字</rbc><rtc><rt>かん</rt><rt>じ</rt></rtc></ruby>と<ruby><rbc>東京</rbc><rtc><rt>とうきょう</rt></rtc></ruby>。</div>`,
  "79e-ruby-jukugo-2char": `<div class="f" style="width:600px;font-size:20px;line-height:2"><ruby>東京<rt>とうきょう</rt></ruby>と<ruby>大阪<rt>おおさか</rt></ruby>と<ruby>日本<rt>にほん</rt></ruby>。</div>`,
  "81-deco-overline": `<div class="v f" style="height:200px"><span style="text-decoration:overline">上線 overline</span></div>`,
  "82-deco-wavy": `<div class="v f" style="height:200px"><span style="text-decoration:underline wavy red">波線 wavy</span></div>`,
  "83-deco-dotted": `<div class="v f" style="height:200px"><span style="text-decoration:underline dotted blue">点線 dotted</span></div>`,
  "84-deco-three-br": `<div class="v f" style="height:200px"><span style="text-decoration:underline">下線 underline</span><br><span style="text-decoration:overline">上線 overline</span><br><span style="text-decoration:line-through">打消 line-through</span></div>`,
  "85-ib-valign-top": `<div class="v f" style="height:200px">前<span style="display:inline-block;width:40px;height:40px;background:#f87171;vertical-align:top"></span>後</div>`,
  "86-ib-two-boxes": `<div class="v f" style="height:200px">前<span style="display:inline-block;width:40px;height:40px;background:#f87171"></span>中<span style="display:inline-block;width:30px;height:60px;background:#34d399"></span>終</div>`,
  "87-ib-text-then-box": `<div class="v f" style="height:200px">中<span style="display:inline-block;border:2px solid #3b82f6;padding:4px">inline-block 内の文</span>後<span style="display:inline-block;width:30px;height:60px;background:#34d399"></span>終</div>`,
  "90-ib-text-before": `<div class="v f" style="height:200px">中<span style="display:inline-block;border:2px solid #3b82f6;padding:4px">ib 内の文</span></div>`,
  "91-ib-text-after": `<div class="v f" style="height:200px"><span style="display:inline-block;border:2px solid #3b82f6;padding:4px">ib 内の文</span>後</div>`,
  "92-ib-text-both": `<div class="v f" style="height:200px">中<span style="display:inline-block;border:2px solid #3b82f6;padding:4px">ib 内の文</span>後</div>`,
  "93-ib-box-both": `<div class="v f" style="height:200px">中<span style="display:inline-block;width:30px;height:60px;background:#34d399"></span>後</div>`,
  "80-justify-last-line": `<div class="v f" style="height:200px;text-align:justify">${N}</div>`,
};

fs.mkdirSync(dir, { recursive: true });
for (const [name, body] of Object.entries(cases)) {
  fs.writeFileSync(path.join(dir, `${name}.html`), head() + body + tail);
}
console.log(Object.keys(cases).length, "cases");
