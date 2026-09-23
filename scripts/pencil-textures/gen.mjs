// 紙とペン風テーマの鉛筆テクスチャ(css/tex/)を作り直すスクリプト。
// 紙の凹凸に芯の粉が乗る様子を lib.js で計算し、assets.js の各部品を画像にする。
// 使い方と注意点は css/tex/README.md を参照。
//
//   node scripts/pencil-textures/gen.mjs                 … 全部作り直す
//   node scripts/pencil-textures/gen.mjs css/tex rule    … 指定した部品だけ
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const here = import.meta.dirname;
const out = resolve(process.argv[2] || resolve(here, "../../css/tex"));
const only = process.argv.slice(3);
await mkdir(out, { recursive: true });

// ブラウザの canvas で PNG / WebP に書き出すので Chromium を使う。
// 手元の Chromium を使うときは CHROMIUM_PATH にその実行ファイルを指定する。
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e));
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: await readFile(resolve(here, "lib.js"), "utf8") });
await page.addScriptTag({ content: await readFile(resolve(here, "assets.js"), "utf8") });

const started = Date.now();
const results = await page.evaluate((names) => ASSETS.build(names.length ? names : undefined), only);
for (const r of results) {
  const ext = r.type === "image/webp" ? "webp" : "png";
  const buf = Buffer.from(r.url.split(",")[1], "base64");
  await writeFile(resolve(out, `${r.name}.${ext}`), buf);
  console.log(r.name.padEnd(16), `${r.w}x${r.h}`.padEnd(10), `${(buf.length / 1024).toFixed(1)}KB`.padStart(8), r.note);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}`);
await browser.close();
