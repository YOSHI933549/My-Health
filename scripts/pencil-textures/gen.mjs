import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const here = import.meta.dirname;
const out = resolve(process.argv[2] || resolve(here, "../../css/tex"));
const only = process.argv.slice(3);
await mkdir(out, { recursive: true });

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
