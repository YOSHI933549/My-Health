import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateDeviceDocument, validateCodexTree, validateInboxDocument } from "./check-codex-inbox.mjs";
import { ALLOWED_INBOX_COMMIT_MESSAGES } from "./check-inbox-commit-message.mjs";
import { encryptMeal, validateMeal } from "./encrypt-meal.mjs";

// One command for the encrypted inbox.
// Stdin is the only place a meal may come from. The device id is the only argument.
// Encryption is encryptMeal (AES-GCM + RSA-OAEP-256). This file does not commit or push,
// and it does not write meal names or nutrient values to stdout or stderr.

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const STRING_FIELDS = ["date", "time", "type", "name", "memo"];
const NUMBER_FIELDS = ["calories", "protein", "fat", "carbs"];
const MEAL_FIELDS = [...STRING_FIELDS, ...NUMBER_FIELDS];
const PLAINTEXT_KEYS = [...MEAL_FIELDS, "weight", "weightKg", "bodyWeight"];

export const MESSAGES = {
  usage: "使い方: node scripts/add-meal.mjs <deviceId>",
  invalidMeal: "食事の項目または型が違います",
  invalidDateTime: "日付または時刻の形が違います",
  deviceNotFound: "端末が見つかりません",
  deviceInvalid: "端末の公開鍵を確認できません",
  inboxNotFound: "受け取り箱が見つかりません",
  inboxInvalid: "受け取り箱を確認できません",
  checkFailed: "受け取り箱の確認に失敗しました",
  plaintext: "平文が残っています",
  failed: "食事を追加できませんでした",
};

const SAFE_MESSAGES = new Set(Object.values(MESSAGES));

export function commitMessageForType(type) {
  const message = `${type}を暗号化受け取り箱に追加`;
  if (!ALLOWED_INBOX_COMMIT_MESSAGES.includes(message)) throw new Error(MESSAGES.invalidMeal);
  return message;
}

export function prepareMeal(meal) {
  if (!meal || typeof meal !== "object" || Array.isArray(meal)) throw new Error(MESSAGES.invalidMeal);
  for (const key of MEAL_FIELDS) {
    if (!Object.hasOwn(meal, key)) throw new Error(MESSAGES.invalidMeal);
  }
  for (const key of Object.keys(meal)) {
    if (!MEAL_FIELDS.includes(key)) throw new Error(MESSAGES.invalidMeal);
  }
  for (const key of STRING_FIELDS) {
    if (typeof meal[key] !== "string") throw new Error(MESSAGES.invalidMeal);
  }
  for (const key of NUMBER_FIELDS) {
    if (typeof meal[key] !== "number" || !Number.isFinite(meal[key])) throw new Error(MESSAGES.invalidMeal);
  }
  try {
    const validated = validateMeal(meal);
    commitMessageForType(validated.type);
    return validated;
  } catch (error) {
    if (error instanceof Error && (error.message === "Invalid date" || error.message === "Invalid time")) {
      throw new Error(MESSAGES.invalidDateTime);
    }
    if (error instanceof Error && SAFE_MESSAGES.has(error.message)) throw error;
    throw new Error(MESSAGES.invalidMeal);
  }
}

export function assertCiphertextOnly(fileText, validatedMeal, rawMeal = validatedMeal) {
  let doc;
  try {
    doc = JSON.parse(fileText);
  } catch {
    throw new Error(MESSAGES.checkFailed);
  }
  walkInbox(doc, "/");
  const markers = new Set();
  for (const source of [validatedMeal, rawMeal]) {
    if (!source || typeof source !== "object") continue;
    for (const key of STRING_FIELDS) {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) markers.add(JSON.stringify(value));
    }
  }
  for (const marker of markers) {
    if (fileText.includes(marker)) throw new Error(MESSAGES.plaintext);
  }
  const plain = Buffer.from(JSON.stringify(validatedMeal), "utf8");
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry.ciphertext !== "string") throw new Error(MESSAGES.checkFailed);
    if (Buffer.from(entry.ciphertext, "base64url").includes(plain)) throw new Error(MESSAGES.plaintext);
  }
}

function walkInbox(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkInbox(item, `${path}${index}/`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (PLAINTEXT_KEYS.includes(key)) throw new Error(MESSAGES.plaintext);
      walkInbox(child, `${path}${key}/`);
    }
    return;
  }
  if (typeof value === "number" && !(path === "/version/" && value === 1)) throw new Error(MESSAGES.plaintext);
}

export async function addMealAt(root, deviceId, meal, options = {}) {
  const validated = prepareMeal(meal);
  const message = commitMessageForType(validated.type);
  if (!DEVICE_ID_RE.test(String(deviceId || ""))) throw new Error(MESSAGES.deviceNotFound);

  const devicePath = join(root, "codex-devices", `${deviceId}.json`);
  const inboxPath = join(root, "codex-inbox", `${deviceId}.json`);
  const deviceFile = readJsonFile(devicePath, MESSAGES.deviceNotFound, MESSAGES.deviceInvalid);
  const inboxFile = readJsonFile(inboxPath, MESSAGES.inboxNotFound, MESSAGES.inboxInvalid);
  if (validateDeviceDocument(deviceFile.json, `${deviceId}.json`).errors.length > 0) {
    throw new Error(MESSAGES.deviceInvalid);
  }
  if (validateInboxDocument(inboxFile.json, `${deviceId}.json`).errors.length > 0) {
    throw new Error(MESSAGES.inboxInvalid);
  }
  if (validateCodexTree(root).length > 0) throw new Error(MESSAGES.checkFailed);

  const inbox = inboxFile.json;
  const seen = new Set(inbox.entries.map((entry) => entry && entry.id));
  let envelope = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await encryptMeal(deviceFile.json, validated);
    if (!seen.has(candidate.id)) {
      envelope = candidate;
      break;
    }
  }
  if (!envelope) throw new Error(MESSAGES.failed);

  const nextText = `${JSON.stringify({ version: inbox.version, deviceId: inbox.deviceId, entries: [...inbox.entries, envelope] }, null, 2)}\n`;
  assertCiphertextOnly(nextText, validated, meal);
  assertNextInbox(deviceFile.json, deviceId, nextText);

  const confirm = options.confirm ?? confirmTree;
  let replaced = false;
  try {
    writeAtomic(inboxPath, nextText);
    replaced = true;
    confirm(root);
    assertCiphertextOnly(readFileSync(inboxPath, "utf8"), validated, meal);
  } catch (error) {
    if (replaced) {
      try {
        writeAtomic(inboxPath, inboxFile.bytes);
      } catch {
        throw new Error(MESSAGES.failed);
      }
    }
    throw safeError(error);
  }
  return message;
}

function confirmTree(root) {
  if (validateCodexTree(root).length > 0) throw new Error(MESSAGES.checkFailed);
}

function assertNextInbox(deviceDoc, deviceId, nextText) {
  let next;
  try {
    next = JSON.parse(nextText);
  } catch {
    throw new Error(MESSAGES.checkFailed);
  }
  const deviceResult = validateDeviceDocument(deviceDoc, `${deviceId}.json`);
  const inboxResult = validateInboxDocument(next, `${deviceId}.json`);
  if (deviceResult.errors.length > 0 || inboxResult.errors.length > 0) throw new Error(MESSAGES.checkFailed);
  if (deviceResult.modulusBytes == null) throw new Error(MESSAGES.checkFailed);
  for (const keyBytes of inboxResult.encryptedKeyBytes) {
    if (keyBytes !== deviceResult.modulusBytes) throw new Error(MESSAGES.checkFailed);
  }
}

function readJsonFile(path, missingMessage, invalidMessage) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error(missingMessage);
  const bytes = readFileSync(path);
  try {
    return { bytes, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    throw new Error(invalidMessage);
  }
}

function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // The original file is still in place until rename succeeds.
    }
    throw new Error(MESSAGES.failed);
  }
}

function safeError(error) {
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error;
  return new Error(MESSAGES.failed);
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw new Error(MESSAGES.usage);
    const text = readFileSync(0, "utf8");
    let meal;
    try {
      meal = JSON.parse(text);
    } catch {
      throw new Error(MESSAGES.invalidMeal);
    }
    const message = await addMealAt(process.cwd(), args[0], meal);
    process.stdout.write(`${message}\n`);
  } catch (error) {
    const safe = safeError(error);
    process.stderr.write(`${safe.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
