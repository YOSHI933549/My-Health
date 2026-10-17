import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// npm run check discovers its targets from the tree.
// Adding a test is a new scripts/test-*.mjs file; package.json stays unchanged.
// scripts/check-*.mjs (the inbox shape check, this reference check, and later
// checks) are executed the same way.
//
// test-encrypted-inbox.mjs used to be syntax-checked only. It has its own
// npm script, but the test itself only needs node:crypto and already passes,
// so discovery runs it with the other tests.

const JS_EXT = /\.(?:js|mjs)$/;

export function discover(root) {
  const syntax = [];
  walk(join(root, "js"), syntax);
  walk(join(root, "scripts"), syntax);
  const sw = join(root, "sw.js");
  if (statSync(sw, { throwIfNoEntry: false })?.isFile()) syntax.push(sw);
  syntax.sort();

  const checks = syntax.filter((file) => /^scripts\/(?:.+\/)?check-[^/]+\.mjs$/.test(relative(root, file)));
  const tests = syntax.filter((file) => /^scripts\/(?:.+\/)?test-[^/]+\.mjs$/.test(relative(root, file)));
  return { syntax, checks, tests };
}

function walk(dir, acc) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    const info = statSync(path, { throwIfNoEntry: false });
    if (!info) continue;
    if (info.isDirectory()) walk(path, acc);
    else if (JS_EXT.test(name)) acc.push(path);
  }
}

function runNode(root, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  return result.status === 0;
}

function main() {
  const root = process.cwd();
  const found = discover(root);
  if (found.tests.length === 0) {
    process.stderr.write("scripts/test-*.mjs が1つもありません\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`文法確認 ${found.syntax.length} ファイル\n`);
  for (const file of found.syntax) {
    if (!runNode(root, ["--check", file])) {
      process.stderr.write(`文法エラー: ${relative(root, file)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  for (const file of [...found.checks, ...found.tests]) {
    const rel = relative(root, file);
    process.stdout.write(`実行 ${rel}\n`);
    if (!runNode(root, [file])) {
      process.stderr.write(`失敗: ${rel}\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write("チェックはすべて成功しました\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
