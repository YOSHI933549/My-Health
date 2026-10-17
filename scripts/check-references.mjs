import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Confirms the service-worker cache list, the files index.html loads, and the
// element ids referenced from js/ all point at something that is actually there.
//
// CACHE_VERSION is still edited by hand. scripts/cache-version-stamp.json records
// the version together with a digest of the cached files. If those files change
// and the version does not, check fails. After raising CACHE_VERSION, update the
// record with: node scripts/check-references.mjs --write-cache-stamp
// sw.js itself is not part of the digest: a byte change in that file already
// makes the browser install the new worker. The version bump is what drops
// cache-first assets (icons and css/tex) after they change.

export const STAMP_PATH = "scripts/cache-version-stamp.json";
const WRITE_FLAG = "--write-cache-stamp";

const VALUE_WORDS = new Set([
  "return",
  "throw",
  "case",
  "typeof",
  "void",
  "delete",
  "await",
  "else",
  "do",
  "in",
  "of",
  "instanceof",
  "yield",
  "new",
]);

export function referenceErrors(root) {
  const errors = [];
  const shell = readShell(root, errors);
  if (!shell) return errors;

  const cached = new Set();
  for (const entry of [...shell.appShell, ...shell.staticAssets]) {
    const rel = normalizePath(entry);
    if (!rel) continue;
    cached.add(rel);
    if (!isFile(root, rel)) errors.push(`sw.js: キャッシュ一覧の "${entry}" が見つかりません`);
  }

  const htmlPath = join(root, "index.html");
  if (!isFile(root, "index.html")) {
    errors.push("index.html が見つかりません");
    return errors;
  }
  const html = readFileSync(htmlPath, "utf8");
  const htmlRefs = htmlLocalRefs(html);
  for (const rel of htmlRefs) {
    if (!isFile(root, rel)) errors.push(`index.html: 読み込んでいる "${rel}" が見つかりません`);
    else if (!cached.has(rel)) errors.push(`index.html: 読み込んでいる "${rel}" が sw.js のキャッシュ一覧にありません`);
  }

  for (const entry of shell.appShell) {
    const rel = normalizePath(entry);
    if (!rel || rel === "index.html") continue;
    if (!htmlRefs.includes(rel)) errors.push(`sw.js: キャッシュ一覧の "${entry}" は index.html から読み込まれていません`);
  }

  const manifestRefs = manifestIconRefs(root, htmlRefs, errors);
  for (const rel of manifestRefs) {
    if (!isFile(root, rel)) errors.push(`manifest.json: アイコン "${rel}" が見つかりません`);
    else if (!cached.has(rel)) errors.push(`manifest.json: アイコン "${rel}" が sw.js のキャッシュ一覧にありません`);
  }

  const ids = htmlIds(html);
  for (const file of jsFiles(root)) {
    const source = readFileSync(join(root, file), "utf8");
    const seen = new Set();
    for (const ref of elementReferences(source)) {
      if (seen.has(ref.id) || ids.has(ref.id)) {
        seen.add(ref.id);
        continue;
      }
      seen.add(ref.id);
      errors.push(`${file}: ${ref.how} の id「${ref.id}」が index.html にありません`);
    }
  }

  return errors;
}

export function cacheStampErrors(root) {
  const errors = [];
  const shell = readShell(root, errors);
  if (!shell || errors.length > 0) return errors;
  const paths = cachedFiles(shell);
  for (const rel of paths) {
    if (!isFile(root, rel)) return [];
  }
  let digest;
  try {
    digest = cacheDigest(root, paths);
  } catch {
    return ["sw.js: キャッシュ一覧のファイルを読めません"];
  }
  const stamp = readStamp(root);
  if (!stamp) {
    return [`${STAMP_PATH} がありません。CACHE_VERSION を確認してから node scripts/check-references.mjs ${WRITE_FLAG} を実行してください`];
  }
  if (stamp.error) return [stamp.error];
  if (stamp.digest === digest && stamp.cacheVersion === shell.version) return [];
  if (stamp.digest !== digest && stamp.cacheVersion === shell.version) {
    return [
      `sw.js: キャッシュ対象のファイルが変わっていますが CACHE_VERSION は ${shell.version} のままです。sw.js の CACHE_VERSION を上げてから node scripts/check-references.mjs ${WRITE_FLAG} を実行してください`,
    ];
  }
  return [
    `${STAMP_PATH}: 記録は ${stamp.cacheVersion} のままですが sw.js の CACHE_VERSION は ${shell.version} です。node scripts/check-references.mjs ${WRITE_FLAG} を実行してください`,
  ];
}

export function checkRepository(root) {
  const errors = referenceErrors(root);
  if (errors.length > 0) return errors;
  return cacheStampErrors(root);
}

export function writeCacheStamp(root) {
  const structural = referenceErrors(root);
  const blocking = structural.filter((error) => !error.startsWith("js/"));
  if (blocking.length > 0) return { ok: false, message: blocking[0] };
  const shell = readShell(root, []);
  if (!shell?.version) return { ok: false, message: "sw.js: CACHE_VERSION を読めません" };
  const version = versionNumber(shell.version);
  if (version == null) return { ok: false, message: `sw.js: CACHE_VERSION "${shell.version}" は v と数値の形にしてください` };
  const digest = cacheDigest(root, cachedFiles(shell));
  const stamp = readStamp(root);
  if (stamp && !stamp.error) {
    if (stamp.digest === digest && stamp.cacheVersion === shell.version) {
      return { ok: true, message: "記録は最新です" };
    }
    const previous = versionNumber(stamp.cacheVersion);
    if (previous == null || version <= previous) {
      return {
        ok: false,
        message: `CACHE_VERSION を ${stamp.cacheVersion} より大きい値にしてから記録を更新してください`,
      };
    }
  }
  const body = `${JSON.stringify({ cacheVersion: shell.version, digest }, null, 2)}\n`;
  const stampFile = join(root, STAMP_PATH);
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, body);
  return { ok: true, message: `${STAMP_PATH} を ${shell.version} で更新しました` };
}

export function elementReferences(source) {
  const refs = [];
  const seen = new Set();
  const add = (id, how) => {
    const key = `${id}\0${how}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ id, how });
  };

  for (const match of source.matchAll(/getElementById\(\s*(["'])([^"']+)\1/g)) {
    add(match[2], `getElementById("${match[2]}")`);
  }
  for (const match of source.matchAll(/querySelector(?:All)?\(\s*(["'`])([^"'`$]+)\1/g)) {
    for (const idMatch of match[2].matchAll(/#([A-Za-z_][\w-]*)/g)) {
      add(idMatch[1], `querySelector("${match[2]}")`);
    }
  }

  const functions = parseFunctions(source);
  const direct = new Set();
  for (const fn of functions) {
    fn.params.forEach((param, index) => {
      if (new RegExp(`getElementById\\(\\s*${param}\\s*\\)`).test(fn.body)) direct.add(keyOf(fn.name, index));
    });
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const fn of functions) {
      if (fn.params.length === 0 || direct.has(keyOf(fn.name, 0))) continue;
      const param = fn.params[0];
      for (const other of functions) {
        if (!direct.has(keyOf(other.name, 0))) continue;
        if (new RegExp(`\\b${other.name}\\(\\s*${param}\\s*[,)]`).test(fn.body)) {
          direct.add(keyOf(fn.name, 0));
          grew = true;
        }
      }
    }
  }

  const legend = new Set();
  for (const fn of functions) {
    if (!direct.has(keyOf(fn.name, 0)) || fn.params.length === 0) continue;
    if (fn.body.includes("`${" + fn.params[0] + "}Legend`")) legend.add(keyOf(fn.name, 0));
  }

  for (const fn of functions) {
    if (!direct.has(keyOf(fn.name, 0))) continue;
    for (const match of source.matchAll(new RegExp(`\\b${fn.name}\\(\\s*(["'])([^"']+)\\1`, "g"))) {
      add(match[2], `${fn.name}("${match[2]}")`);
      if (legend.has(keyOf(fn.name, 0))) add(`${match[2]}Legend`, `${fn.name}("${match[2]}") の凡例`);
    }
  }
  return refs;
}

function keyOf(name, index) {
  return `${name}\0${index}`;
}

function main() {
  const root = process.cwd();
  if (process.argv.includes(WRITE_FLAG)) {
    const result = writeCacheStamp(root);
    const stream = result.ok ? process.stdout : process.stderr;
    stream.write(`${result.message}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const errors = checkRepository(root);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("App file references passed.\n");
}

function readShell(root, errors) {
  const path = join(root, "sw.js");
  if (!isFile(root, "sw.js")) {
    errors.push("sw.js が見つかりません");
    return null;
  }
  const source = readFileSync(path, "utf8");
  const versionMatch = source.match(/const\s+CACHE_VERSION\s*=\s*["']([^"']+)["']/);
  const appShell = readStringArray(source, "APP_SHELL");
  const staticAssets = readStringArray(source, "STATIC_ASSETS");
  if (!versionMatch) errors.push("sw.js: CACHE_VERSION を読めません");
  if (!appShell) errors.push("sw.js: APP_SHELL を読めません");
  if (!staticAssets) errors.push("sw.js: STATIC_ASSETS を読めません");
  if (!versionMatch || !appShell || !staticAssets) return null;
  return { version: versionMatch[1], appShell, staticAssets };
}

function readStringArray(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function cachedFiles(shell) {
  const paths = [];
  for (const entry of [...shell.appShell, ...shell.staticAssets]) {
    const rel = normalizePath(entry);
    if (rel) paths.push(rel);
  }
  return [...new Set(paths)].sort();
}

function cacheDigest(root, paths) {
  const hash = createHash("sha256");
  for (const rel of paths) {
    const fileHash = createHash("sha256").update(readFileSync(join(root, rel))).digest("hex");
    hash.update(rel);
    hash.update("\0");
    hash.update(fileHash);
    hash.update("\n");
  }
  return hash.digest("hex");
}

function readStamp(root) {
  const path = join(root, STAMP_PATH);
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    if (!json || typeof json.cacheVersion !== "string" || typeof json.digest !== "string") {
      return { error: `${STAMP_PATH}: cacheVersion と digest がありません` };
    }
    return json;
  } catch {
    return { error: `${STAMP_PATH}: JSON として読めません` };
  }
}

function versionNumber(value) {
  const match = /^v(\d+)$/.exec(value || "");
  return match ? Number(match[1]) : null;
}

function htmlLocalRefs(html) {
  const refs = [];
  for (const match of html.matchAll(/<(script|link|img)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const rel = (attr(attrs, "rel") || "").toLowerCase();
    let url = null;
    if (tag === "script" || tag === "img") url = attr(attrs, "src");
    else if (rel.includes("stylesheet") || rel === "manifest" || rel.includes("icon")) url = attr(attrs, "href");
    if (!url || isExternal(url)) continue;
    const path = normalizePath(url.split("#")[0].split("?")[0]);
    if (path) refs.push(path);
  }
  return refs;
}

function manifestIconRefs(root, htmlRefs, errors) {
  if (!htmlRefs.includes("manifest.json") || !isFile(root, "manifest.json")) return [];
  let json;
  try {
    json = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  } catch {
    errors.push("manifest.json: JSON として読めません");
    return [];
  }
  if (!Array.isArray(json.icons)) return [];
  return json.icons.map((icon) => normalizePath(String(icon?.src || "").split("#")[0].split("?")[0])).filter(Boolean);
}

function htmlIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/g)) ids.add(match[2]);
  return ids;
}

function jsFiles(root) {
  const dir = join(root, "js");
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => join("js", name));
}

function attr(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? match[1] ?? match[2] : null;
}

function isExternal(url) {
  return /^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:") || url.startsWith("#") || url.startsWith("mailto:");
}

function normalizePath(value) {
  let path = String(value || "").trim();
  if (path === "." || path === "./" || path === "") return "";
  if (path.startsWith("./")) path = path.slice(2);
  if (path.startsWith("/")) path = path.slice(1);
  return path;
}

function isFile(root, rel) {
  return statSync(join(root, rel), { throwIfNoEntry: false })?.isFile() === true;
}

function parseFunctions(source) {
  const functions = [];
  const re = /(?:^|[^\w$])function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1];
    const parenOpen = match.index + match[0].length - 1;
    const parenClose = findClosingParen(source, parenOpen);
    const params = source
      .slice(parenOpen + 1, parenClose)
      .split(",")
      .map((part) => part.trim().split("=")[0].trim())
      .filter((part) => /^[A-Za-z_$][\w$]*$/.test(part));
    let brace = parenClose + 1;
    while (brace < source.length && /\s/.test(source[brace])) brace++;
    if (source[brace] !== "{") continue;
    const braceEnd = findMatchingBrace(source, brace);
    functions.push({ name, params, body: source.slice(brace + 1, braceEnd) });
  }
  return functions;
}

function findClosingParen(source, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"') {
      i = skipQuoted(source, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(source, i);
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return source.length - 1;
}

function findMatchingBrace(source, openIndex) {
  let i = openIndex + 1;
  let depth = 1;
  let expectValue = true;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i += 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(source, i);
      expectValue = false;
      continue;
    }
    if (c === "`") {
      i = skipTemplate(source, i);
      expectValue = false;
      continue;
    }
    if (c === "/" && expectValue) {
      i = skipRegex(source, i);
      expectValue = false;
      continue;
    }
    if (c === "{") {
      depth += 1;
      expectValue = true;
      i += 1;
      continue;
    }
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
      expectValue = false;
      i += 1;
      continue;
    }
    if (c === "(" || c === "[") {
      expectValue = true;
      i += 1;
      continue;
    }
    if (c === ")" || c === "]") {
      expectValue = false;
      i += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c) || (c >= "0" && c <= "9")) {
      const start = i;
      i += 1;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
      expectValue = VALUE_WORDS.has(source.slice(start, i));
      continue;
    }
    expectValue = c !== ".";
    i += 1;
  }
  return source.length - 1;
}

function skipQuoted(source, i) {
  const quote = source[i];
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplate(source, i) {
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") return i + 1;
    if (source[i] === "$" && source[i + 1] === "{") {
      const end = findMatchingBrace(source, i + 1);
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return i;
}

function skipRegex(source, i) {
  i += 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i;
    if (c === "[" && !inClass) inClass = true;
    else if (c === "]" && inClass) inClass = false;
    else if (c === "/" && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return i;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
