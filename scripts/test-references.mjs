import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discover } from "./run-checks.mjs";
import {
  cacheStampErrors,
  checkRepository,
  elementReferences,
  referenceErrors,
  writeCacheStamp,
} from "./check-references.mjs";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(packageJson.scripts.check, "node scripts/run-checks.mjs");
assert.equal(packageJson.scripts.check.includes("test-encrypted-inbox"), false);

const found = discover(root);
assert.ok(found.syntax.some((file) => file.endsWith("sw.js")));
assert.ok(found.syntax.some((file) => file.endsWith("scripts/pencil-textures/gen.mjs")));
assert.ok(found.syntax.some((file) => file.endsWith("scripts/build-web.mjs")));
assert.ok(found.checks.some((file) => file.endsWith("scripts/check-codex-inbox.mjs")));
assert.ok(found.checks.some((file) => file.endsWith("scripts/check-references.mjs")));
assert.ok(found.tests.some((file) => file.endsWith("scripts/test-encrypted-inbox.mjs")));
assert.ok(found.tests.some((file) => file.endsWith("scripts/test-inbox-guard.mjs")));
assert.equal(found.tests.some((file) => file.includes("test-helpers")), false);

const appIds = elementReferences(readFileSync(new URL("../js/app.js", import.meta.url), "utf8"));
const idSet = new Set(appIds.map((item) => item.id));
assert.ok(idSet.has("weightChart"));
assert.ok(idSet.has("weightChartFull"));
assert.ok(idSet.has("weightChartLegend"));
assert.ok(idSet.has("weightChartFullLegend"));
assert.ok(idSet.has("calorieChart"));
assert.ok(idSet.has("calorieChartFull"));
assert.equal(idSet.has("calorieChartLegend"), false);
assert.ok(idSet.has("fatigueAxis"));
assert.ok(idSet.has("mealForm"));

assert.deepEqual(referenceErrors(root), []);
assert.deepEqual(checkRepository(root), []);

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "yoshi-refs-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

const baseFiles = {
  "sw.js": `const CACHE_VERSION = "v1";
const APP_SHELL = ["./", "./index.html", "./css/style.css", "./js/app.js", "./manifest.json"];
const STATIC_ASSETS = ["./icons/icon.png"];
`,
  "index.html": `<link rel="stylesheet" href="css/style.css">
<link rel="manifest" href="manifest.json">
<img src="icons/icon.png" alt="">
<div id="title"></div>
<script src="js/app.js"></script>
`,
  "manifest.json": JSON.stringify({ icons: [{ src: "icons/icon.png" }] }),
  "css/style.css": "body{}\n",
  "js/app.js": `document.getElementById("title");
function draw(canvasId) { document.getElementById(canvasId); }
function show(canvasId) { draw(canvasId); }
show("title");
`,
  "icons/icon.png": "png",
};

{
  const dir = fixture(baseFiles);
  try {
    assert.deepEqual(referenceErrors(dir), []);
    const created = writeCacheStamp(dir);
    assert.equal(created.ok, true);
    assert.deepEqual(checkRepository(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = fixture({
    ...baseFiles,
    "sw.js": baseFiles["sw.js"].replace('"./js/app.js"', '"./js/app.js", "./js/missing.js"'),
  });
  try {
    const errors = referenceErrors(dir);
    assert.ok(errors.some((error) => error.includes("sw.js") && error.includes("./js/missing.js")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = fixture({
    ...baseFiles,
    "js/app.js": 'document.getElementById("missing-panel");\n',
  });
  try {
    const errors = referenceErrors(dir);
    assert.ok(errors.some((error) => error.includes("js/app.js") && error.includes("missing-panel") && error.includes("index.html")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = fixture({
    ...baseFiles,
    "js/app.js": `function draw(canvasId) { document.getElementById(canvasId); }
draw("missing-canvas");
`,
  });
  try {
    const errors = referenceErrors(dir);
    assert.ok(errors.some((error) => error.includes("missing-canvas")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = fixture({
    ...baseFiles,
    "index.html": baseFiles["index.html"].replace(
      '<script src="js/app.js"></script>',
      '<script src="js/app.js"></script><script src="js/extra.js"></script>'
    ),
    "js/extra.js": "document.getElementById('title');\n",
  });
  try {
    const errors = referenceErrors(dir);
    assert.ok(errors.some((error) => error.includes("index.html") && error.includes("js/extra.js") && error.includes("sw.js")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = fixture(baseFiles);
  try {
    assert.equal(writeCacheStamp(dir).ok, true);
    writeFileSync(join(dir, "css/style.css"), "body{color:red}\n");
    const drifted = cacheStampErrors(dir);
    assert.ok(drifted.some((error) => error.includes("CACHE_VERSION") && error.includes("v1")));
    assert.equal(writeCacheStamp(dir).ok, false);
    writeFileSync(join(dir, "sw.js"), baseFiles["sw.js"].replace('const CACHE_VERSION = "v1";', 'const CACHE_VERSION = "v2";'));
    const stale = cacheStampErrors(dir);
    assert.ok(stale.some((error) => error.includes("cache-version-stamp.json") && error.includes("v2")));
    assert.equal(writeCacheStamp(dir).ok, true);
    assert.deepEqual(checkRepository(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "yoshi-discover-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "js"), { recursive: true });
    writeFileSync(join(dir, "scripts/test-fresh.mjs"), "export {};\n");
    writeFileSync(join(dir, "sw.js"), "const CACHE_VERSION = 'v1';\n");
    const nested = discover(dir);
    assert.ok(nested.tests.some((file) => file.endsWith("scripts/test-fresh.mjs")));
    assert.ok(nested.syntax.some((file) => file.endsWith("sw.js")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write("Reference checks passed.\n");
