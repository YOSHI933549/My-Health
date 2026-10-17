import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptMeal } from "./encrypt-meal.mjs";
import { validateCodexTree } from "./check-codex-inbox.mjs";
import { ALLOWED_INBOX_COMMIT_MESSAGES } from "./check-inbox-commit-message.mjs";
import { addMealAt, assertCiphertextOnly, commitMessageForType, MESSAGES, prepareMeal } from "./add-meal.mjs";

// Same steps as decryptCodexMeal in js/codex-sync.js: RSA-OAEP-256 unwraps the AES key,
// then AES-GCM opens the meal JSON. This test never reads codex-devices/ or codex-inbox/.

const { subtle } = webcrypto;
const script = fileURLToPath(new URL("./add-meal.mjs", import.meta.url));
const checkScript = fileURLToPath(new URL("./check-codex-inbox.mjs", import.meta.url));
const roots = [];

function track(root) {
  roots.push(root);
  return root;
}

function freshRoot() {
  const root = track(mkdtempSync(join(tmpdir(), "add-meal-test-")));
  mkdirSync(join(root, "codex-devices"));
  mkdirSync(join(root, "codex-inbox"));
  return root;
}

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
const privateJwk = await subtle.exportKey("jwk", keys.privateKey);
const privateKey = await subtle.importKey("jwk", privateJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);

function meal(type = "昼食", overrides = {}) {
  return {
    date: "2026-10-17",
    time: "12:00",
    type,
    name: "zz-add-meal-name-zz",
    calories: 101.25,
    protein: 11.5,
    fat: 7.25,
    carbs: 44.5,
    memo: "zz-add-meal-memo-zz",
    ...overrides,
  };
}

function writeTree(root, deviceId, inbox) {
  const device = { version: 1, deviceId, publicKey };
  const devicePath = join(root, "codex-devices", `${deviceId}.json`);
  const inboxPath = join(root, "codex-inbox", `${deviceId}.json`);
  writeFileSync(devicePath, `${JSON.stringify(device, null, 2)}\n`);
  if (inbox) writeFileSync(inboxPath, `${JSON.stringify(inbox, null, 2)}\n`);
  return { devicePath, inboxPath };
}

function run(root, args, stdin) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    input: stdin,
    encoding: "utf8",
  });
}

async function decryptEntry(entry) {
  const rawAesKey = await subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(entry.encryptedKey, "base64url"));
  const aesKey = await subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(entry.iv, "base64url") },
    aesKey,
    Buffer.from(entry.ciphertext, "base64url")
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function assertNoLeak(result, sample) {
  const blob = `${result.stdout}${result.stderr}`;
  for (const secret of [sample.name, sample.memo, String(sample.calories), String(sample.protein), String(sample.fat), String(sample.carbs)]) {
    assert.equal(blob.includes(secret), false);
  }
}

function assertUnchanged(path, before) {
  assert.equal(Buffer.compare(readFileSync(path), before), 0);
  assert.equal(readdirSync(join(path, "..")).some((name) => name.endsWith(".tmp")), false);
}

try {
  for (const type of ["朝食", "昼食", "夕食", "間食"]) {
    const message = commitMessageForType(type);
    assert.equal(ALLOWED_INBOX_COMMIT_MESSAGES.includes(message), true);
    assert.equal(message, `${type}を暗号化受け取り箱に追加`);
  }
  assert.throws(() => prepareMeal(meal("夜食")), { message: MESSAGES.invalidMeal });
  assert.throws(() => prepareMeal(meal("昼食", { date: "2026/10/17" })), { message: MESSAGES.invalidDateTime });
  assert.throws(() => prepareMeal(meal("昼食", { time: "7:30" })), { message: MESSAGES.invalidDateTime });
  assert.throws(() => prepareMeal(meal("昼食", { time: "25:00" })), { message: MESSAGES.invalidDateTime });
  assert.throws(() => prepareMeal(meal("昼食", { time: "12:60" })), { message: MESSAGES.invalidDateTime });
  assert.throws(() => prepareMeal(meal("昼食", { date: "2026-02-30" })), { message: MESSAGES.invalidDateTime });
  assert.throws(() => prepareMeal(meal("昼食", { date: "2026-13-01" })), { message: MESSAGES.invalidDateTime });
  assert.deepEqual(prepareMeal(meal("昼食", { date: "2026-02-28", time: "08:27" })), meal("昼食", { date: "2026-02-28", time: "08:27" }));
  assert.deepEqual(prepareMeal(meal("間食", { date: "2024-02-29", time: "00:00" })), meal("間食", { date: "2024-02-29", time: "00:00" }));
  assert.deepEqual(prepareMeal(meal("夕食", { date: "2026-12-31", time: "23:59" })), meal("夕食", { date: "2026-12-31", time: "23:59" }));
  assert.throws(() => prepareMeal(meal("昼食", { calories: "101.25" })), { message: MESSAGES.invalidMeal });

  const leaked = meal();
  assert.throws(
    () => assertCiphertextOnly(JSON.stringify({ version: 1, entries: [{ name: leaked.name, calories: leaked.calories }] }), leaked, leaked),
    (error) => {
      assert.equal(error.message, MESSAGES.plaintext);
      assert.equal(error.message.includes(leaked.name), false);
      assert.equal(String(error.message).includes(String(leaked.calories)), false);
      return true;
    }
  );

  const deviceId = "addmealtest0001";
  const root = freshRoot();
  const existingMeal = meal("朝食", { name: "zz-existing-envelope-zz", time: "07:30", calories: 80, memo: "zz-existing-memo-zz" });
  const existing = await encryptMeal({ version: 1, deviceId, publicKey }, existingMeal);
  const { devicePath, inboxPath } = writeTree(root, deviceId, { version: 1, deviceId, entries: [existing] });
  const deviceBefore = readFileSync(devicePath);

  const added = [];
  for (const type of ["朝食", "昼食", "夕食", "間食"]) {
    const sample = meal(type, { time: type === "朝食" ? "07:30" : "12:00" });
    const result = run(root, [deviceId], `${JSON.stringify(sample)}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${type}を暗号化受け取り箱に追加\n`);
    assert.equal(result.stderr, "");
    assertNoLeak(result, sample);
    added.push(sample);
  }

  const inbox = JSON.parse(readFileSync(inboxPath, "utf8"));
  assert.equal(inbox.entries.length, 5);
  assert.equal(inbox.entries[0].ciphertext, existing.ciphertext);
  assert.deepEqual(await decryptEntry(inbox.entries[0]), existingMeal);
  for (let index = 0; index < added.length; index += 1) {
    assert.deepEqual(await decryptEntry(inbox.entries[index + 1]), added[index]);
  }
  const inboxText = readFileSync(inboxPath, "utf8");
  assertCiphertextOnly(inboxText, added[1], added[1]);
  for (const sample of [existingMeal, ...added]) {
    assert.equal(inboxText.includes(JSON.stringify(sample.name)), false);
    assert.equal(inboxText.includes(JSON.stringify(sample.memo)), false);
    assert.equal(inboxText.includes('"calories"'), false);
    assert.equal(inboxText.includes('"name"'), false);
  }
  assert.deepEqual(validateCodexTree(root), []);
  const check = spawnSync(process.execPath, [checkScript], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Codex inbox files passed/);
  assert.equal(Buffer.compare(readFileSync(devicePath), deviceBefore), 0);
  assert.deepEqual(readdirSync(join(root, "codex-inbox")), [`${deviceId}.json`]);

  const clockMeal = meal("昼食", { date: "2026-02-28", time: "08:27" });
  const clockResult = run(root, [deviceId], JSON.stringify(clockMeal));
  assert.equal(clockResult.status, 0, clockResult.stderr);
  assert.equal(clockResult.stdout, "昼食を暗号化受け取り箱に追加\n");
  assert.equal(clockResult.stderr, "");
  assertNoLeak(clockResult, clockMeal);
  const clockInbox = JSON.parse(readFileSync(inboxPath, "utf8"));
  assert.equal(clockInbox.entries.length, 6);
  assert.deepEqual(await decryptEntry(clockInbox.entries[5]), clockMeal);

  const beforeFailure = readFileSync(inboxPath);
  const failures = [
    { args: [deviceId], stdin: "{", stderr: MESSAGES.invalidMeal },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { date: "17-10-2026" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { time: "12:0" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { time: "25:00" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { time: "12:60" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { date: "2026-02-30" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { date: "2026-13-01" })), stderr: MESSAGES.invalidDateTime },
    { args: [deviceId], stdin: JSON.stringify(meal("夜食")), stderr: MESSAGES.invalidMeal },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { calories: "101.25" })), stderr: MESSAGES.invalidMeal },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { protein: -1 })), stderr: MESSAGES.invalidMeal },
    { args: [deviceId], stdin: JSON.stringify(meal("昼食", { note: "x" })), stderr: MESSAGES.invalidMeal },
    { args: [deviceId], stdin: JSON.stringify({ date: "2026-10-17" }), stderr: MESSAGES.invalidMeal },
    { args: [], stdin: JSON.stringify(meal()), stderr: MESSAGES.usage },
    { args: [deviceId, meal().name], stdin: JSON.stringify(meal()), stderr: MESSAGES.usage },
    { args: [meal().name], stdin: JSON.stringify(meal()), stderr: MESSAGES.deviceNotFound },
    { args: ["../zz-add-meal-name-zz"], stdin: JSON.stringify(meal()), stderr: MESSAGES.deviceNotFound },
    { args: ["missingdevice01"], stdin: JSON.stringify(meal()), stderr: MESSAGES.deviceNotFound },
  ];
  for (const failure of failures) {
    const result = run(root, failure.args, failure.stdin);
    assert.equal(result.status, 1, JSON.stringify(failure.args));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${failure.stderr}\n`);
    assertNoLeak(result, meal());
    assertUnchanged(inboxPath, beforeFailure);
    assert.equal(Buffer.compare(readFileSync(devicePath), deviceBefore), 0);
  }

  const brokenRoot = freshRoot();
  const brokenId = "addmealtest0002";
  writeTree(brokenRoot, brokenId, { version: 1, deviceId: brokenId, entries: [] });
  const brokenPath = join(brokenRoot, "codex-inbox", `${brokenId}.json`);
  const brokenBytes = Buffer.from("{not-json\n", "utf8");
  writeFileSync(brokenPath, brokenBytes);
  const broken = run(brokenRoot, [brokenId], JSON.stringify(meal()));
  assert.equal(broken.status, 1);
  assert.equal(broken.stderr, `${MESSAGES.inboxInvalid}\n`);
  assertNoLeak(broken, meal());
  assert.equal(Buffer.compare(readFileSync(brokenPath), brokenBytes), 0);

  const plainRoot = freshRoot();
  const plainId = "addmealtest0003";
  const plainInbox = {
    version: 1,
    deviceId: plainId,
    entries: [{ id: "plainentry01", deviceId: plainId, name: "zz-plain-name-zz", calories: 1 }],
  };
  const { inboxPath: plainPath } = writeTree(plainRoot, plainId, plainInbox);
  const plainBefore = readFileSync(plainPath);
  const plain = run(plainRoot, [plainId], JSON.stringify(meal()));
  assert.equal(plain.status, 1);
  assert.equal(plain.stderr, `${MESSAGES.inboxInvalid}\n`);
  assert.equal(plain.stderr.includes("zz-plain-name-zz"), false);
  assert.equal(plain.stdout.includes("zz-plain-name-zz"), false);
  assertUnchanged(plainPath, plainBefore);

  const absentInbox = freshRoot();
  const absentId = "addmealtest0004";
  writeTree(absentInbox, absentId, null);
  const absent = run(absentInbox, [absentId], JSON.stringify(meal()));
  assert.equal(absent.status, 1);
  assert.equal(absent.stderr, `${MESSAGES.inboxNotFound}\n`);
  assert.equal(readdirSync(join(absentInbox, "codex-inbox")).length, 0);

  const absentDevice = freshRoot();
  const orphanId = "addmealtest0005";
  const orphanPath = join(absentDevice, "codex-inbox", `${orphanId}.json`);
  writeFileSync(orphanPath, `${JSON.stringify({ version: 1, deviceId: orphanId, entries: [] }, null, 2)}\n`);
  const orphanBefore = readFileSync(orphanPath);
  const orphan = run(absentDevice, [orphanId], JSON.stringify(meal()));
  assert.equal(orphan.status, 1);
  assert.equal(orphan.stderr, `${MESSAGES.deviceNotFound}\n`);
  assertUnchanged(orphanPath, orphanBefore);

  const privateRoot = freshRoot();
  const privateId = "addmealtest0006";
  const { devicePath: privateDevicePath, inboxPath: privateInboxPath } = writeTree(privateRoot, privateId, {
    version: 1,
    deviceId: privateId,
    entries: [],
  });
  const privateDevice = JSON.parse(readFileSync(privateDevicePath, "utf8"));
  privateDevice.publicKey.d = "zz-not-a-private-key-zz";
  writeFileSync(privateDevicePath, `${JSON.stringify(privateDevice, null, 2)}\n`);
  const privateBefore = readFileSync(privateInboxPath);
  const privateResult = run(privateRoot, [privateId], JSON.stringify(meal()));
  assert.equal(privateResult.status, 1);
  assert.equal(privateResult.stderr, `${MESSAGES.deviceInvalid}\n`);
  assert.equal(privateResult.stderr.includes("zz-not-a-private-key-zz"), false);
  assertUnchanged(privateInboxPath, privateBefore);

  const rollbackRoot = freshRoot();
  const rollbackId = "addmealtest0007";
  const { inboxPath: rollbackPath } = writeTree(rollbackRoot, rollbackId, { version: 1, deviceId: rollbackId, entries: [] });
  const rollbackBefore = readFileSync(rollbackPath);
  await assert.rejects(
    () => addMealAt(rollbackRoot, rollbackId, meal(), {
      confirm() {
        throw new Error(MESSAGES.checkFailed);
      },
    }),
    { message: MESSAGES.checkFailed }
  );
  assertUnchanged(rollbackPath, rollbackBefore);
  assert.equal(JSON.parse(readFileSync(rollbackPath, "utf8")).entries.length, 0);

  process.stdout.write("Add-meal tests passed. A temporary inbox round-tripped, and rejected input left the files unchanged.\n");
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
