import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { encryptMeal } from "./encrypt-meal.mjs";
import { validateCodexTree } from "./check-codex-inbox.mjs";
import {
  ALLOWED_INBOX_COMMIT_MESSAGES,
  checkInboxCommitRange,
  inboxCommitProblem,
} from "./check-inbox-commit-message.mjs";

const { subtle } = webcrypto;
const DISH_MESSAGE = "昼食に牛めしを暗号化受け取り箱に追加";
const SENTINEL_NAME = "zz-dummy-meal-name-zz";
const SENTINEL_SECRET = "zz-dummy-private-material-zz";

function assertClean(errors, ...secrets) {
  const text = errors.join("\n");
  for (const secret of secrets) assert.equal(text.includes(secret), false);
  return text;
}

async function validTree() {
  const keys = await subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
  const publicKey = await subtle.exportKey("jwk", keys.publicKey);
  const privateKey = await subtle.exportKey("jwk", keys.privateKey);
  const deviceId = "testdeviceguard01";
  const device = { version: 1, deviceId, publicKey };
  const meal = {
    date: "2026-01-02",
    time: "12:34",
    type: "昼食",
    name: SENTINEL_NAME,
    calories: 1,
    protein: 1,
    fat: 1,
    carbs: 1,
    memo: "dummy",
  };
  const envelope = await encryptMeal(device, meal);
  const inbox = { version: 1, deviceId, entries: [envelope] };
  return { device, inbox, privateKey, envelope };
}

function writeTree(root, device, inbox) {
  mkdirSync(join(root, "codex-devices"));
  mkdirSync(join(root, "codex-inbox"));
  writeFileSync(join(root, "codex-devices", `${device.deviceId}.json`), `${JSON.stringify(device)}\n`);
  writeFileSync(join(root, "codex-inbox", `${inbox.deviceId}.json`), `${JSON.stringify(inbox)}\n`);
}

const repoErrors = validateCodexTree(process.cwd());
assert.deepEqual(repoErrors, []);
const repoOutput = execFileSync("node", ["scripts/check-codex-inbox.mjs"], { encoding: "utf8" });
assert.match(repoOutput, /Codex inbox files passed/);

const fixture = await validTree();
const tempRoot = mkdtempSync(join(tmpdir(), "inbox-guard-"));
try {
  writeTree(tempRoot, fixture.device, fixture.inbox);
  assert.deepEqual(validateCodexTree(tempRoot), []);

  const plaintextInbox = structuredClone(fixture.inbox);
  Object.assign(plaintextInbox.entries[0], {
    date: "2026-01-02",
    time: "12:34",
    type: "昼食",
    name: SENTINEL_NAME,
    calories: 1,
    protein: 1,
    fat: 1,
    carbs: 1,
    memo: "dummy",
    weight: 60,
  });
  const plaintextRoot = mkdtempSync(join(tmpdir(), "inbox-guard-plain-"));
  try {
    writeTree(plaintextRoot, fixture.device, plaintextInbox);
    const errors = validateCodexTree(plaintextRoot);
    const text = assertClean(errors, SENTINEL_NAME, fixture.envelope.ciphertext, fixture.envelope.encryptedKey);
    assert.match(text, /平文の健康記録の項目 "calories"/);
    assert.match(text, /平文の健康記録の項目 "weight"/);
    assert.equal(errors.length > 0, true);
  } finally {
    rmSync(plaintextRoot, { recursive: true, force: true });
  }

  const privateDevice = structuredClone(fixture.device);
  privateDevice.publicKey.d = fixture.privateKey.d;
  privateDevice.publicKey.key_ops = ["encrypt", "decrypt"];
  const privateRoot = mkdtempSync(join(tmpdir(), "inbox-guard-key-"));
  try {
    writeTree(privateRoot, privateDevice, fixture.inbox);
    const errors = validateCodexTree(privateRoot);
    const text = assertClean(errors, fixture.privateKey.d, SENTINEL_SECRET, fixture.envelope.ciphertext);
    assert.match(text, /秘密鍵らしい項目 "d"/);
    assert.match(text, /秘密鍵らしい操作 "decrypt"/);
  } finally {
    rmSync(privateRoot, { recursive: true, force: true });
  }

  const pemDevice = structuredClone(fixture.device);
  pemDevice.publicKey.n = `-----BEGIN PRIVATE KEY-----\n${SENTINEL_SECRET}\n-----END PRIVATE KEY-----`;
  const pemRoot = mkdtempSync(join(tmpdir(), "inbox-guard-pem-"));
  try {
    writeTree(pemRoot, pemDevice, fixture.inbox);
    const errors = validateCodexTree(pemRoot);
    const text = assertClean(errors, SENTINEL_SECRET);
    assert.match(text, /秘密鍵らしい文字列/);
  } finally {
    rmSync(pemRoot, { recursive: true, force: true });
  }

  const unsafeKey = "ダミー料理名";
  const unexpectedInbox = structuredClone(fixture.inbox);
  unexpectedInbox.note = "extra";
  unexpectedInbox[unsafeKey] = "extra";
  const unexpectedRoot = mkdtempSync(join(tmpdir(), "inbox-guard-extra-"));
  try {
    writeTree(unexpectedRoot, fixture.device, unexpectedInbox);
    const errors = validateCodexTree(unexpectedRoot);
    const text = assertClean(errors, unsafeKey, SENTINEL_NAME, fixture.envelope.ciphertext);
    assert.match(text, /想定外の項目 "note"/);
    assert.match(text, /\/\?: 想定外の項目$/m);
  } finally {
    rmSync(unexpectedRoot, { recursive: true, force: true });
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

for (const message of ALLOWED_INBOX_COMMIT_MESSAGES) {
  assert.equal(inboxCommitProblem(message, ["codex-inbox/device.json"]), null);
  assert.equal(inboxCommitProblem(`${message}\n`, ["codex-devices/device.json"]), null);
}
assert.equal(inboxCommitProblem("昼食を暗号化受け取り箱に追加", ["js/app.js"]), null);
const dishProblem = inboxCommitProblem(DISH_MESSAGE, ["codex-inbox/device.json"]);
assert.equal(dishProblem, "コミットメッセージが受け取り箱用の決まった文言ではありません");
assert.equal(dishProblem.includes("牛めし"), false);
assert.equal(
  inboxCommitProblem("昼食を暗号化受け取り箱に追加\n\n牛めし", ["codex-inbox/device.json"]),
  "コミットメッセージが受け取り箱用の決まった文言ではありません"
);

const procedureFiles = ["CLAUDE.md", "AGENTS.md", "README.md", ".claude/skills/record-meal/SKILL.md"];
for (const file of procedureFiles) {
  const text = readFileSync(file, "utf8");
  for (const message of ALLOWED_INBOX_COMMIT_MESSAGES) assert.equal(text.includes(message), true, file);
}

const workflow = readFileSync(".github/workflows/inbox-guard.yml", "utf8");
const deploy = readFileSync(".github/workflows/deploy-pages.yml", "utf8");
assert.match(workflow, /push:\n\s+branches: \[main\]/);
assert.match(workflow, /pull_request:/);
assert.doesNotMatch(workflow, /deploy-pages|github-pages|pages: write/);
assert.match(deploy, /needs: \[changes, check\]/);
assert.doesNotMatch(deploy, /inbox-guard/);
assert.match(deploy, /needs\.changes\.outputs\.inbox_only == 'true'/);
assert.match(deploy, /inbox_only != 'true'/);
assert.match(workflow, /node scripts\/check-codex-inbox\.mjs/);
assert.match(workflow, /node scripts\/check-inbox-commit-message\.mjs/);

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Inbox Guard Test",
  GIT_AUTHOR_EMAIL: "inbox-guard@example.com",
  GIT_COMMITTER_NAME: "Inbox Guard Test",
  GIT_COMMITTER_EMAIL: "inbox-guard@example.com",
};
const gitRoot = mkdtempSync(join(tmpdir(), "inbox-guard-git-"));
function git(args) {
  return execFileSync("git", args, { cwd: gitRoot, env: gitEnv, encoding: "utf8" });
}
try {
  git(["init", "--quiet"]);
  writeFileSync(join(gitRoot, "README.md"), "test\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "initial"]);
  const base = git(["rev-parse", "HEAD"]).trim();
  mkdirSync(join(gitRoot, "codex-inbox"));
  writeFileSync(join(gitRoot, "codex-inbox", "dummy.json"), "{}\n");
  git(["add", "codex-inbox/dummy.json"]);
  git(["commit", "-m", DISH_MESSAGE]);
  const bad = git(["rev-parse", "HEAD"]).trim();
  const problems = checkInboxCommitRange(gitRoot, base, bad);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /決まった文言ではありません/);
  assert.equal(problems.join("\n").includes("牛めし"), false);

  writeFileSync(join(gitRoot, "codex-inbox", "dummy.json"), "{ }\n");
  git(["add", "codex-inbox/dummy.json"]);
  git(["commit", "-m", "昼食を暗号化受け取り箱に追加"]);
  const good = git(["rev-parse", "HEAD"]).trim();
  assert.deepEqual(checkInboxCommitRange(gitRoot, bad, good), []);
} finally {
  rmSync(gitRoot, { recursive: true, force: true });
}

process.stdout.write("Inbox guard tests passed. Plaintext fields, private-key material, and a dish-name commit message were rejected.\n");
