import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Shape comes from scripts/encrypt-meal.mjs and js/codex-sync.js.
// Device files are the public JWK the app exports (version, deviceId, publicKey).
// Inbox entries are the hybrid envelope encryptMeal returns and decryptCodexMeal reads.
// This script never decrypts and never prints field values.

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const PRIVATE_KEY_TEXT_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

const DEVICE_KEYS = new Set(["version", "deviceId", "publicKey"]);
const PUBLIC_KEY_KEYS = new Set(["alg", "e", "ext", "key_ops", "kty", "n"]);
const INBOX_KEYS = new Set(["version", "deviceId", "entries"]);
const ENTRY_KEYS = new Set(["id", "deviceId", "encryptedKey", "iv", "ciphertext"]);

const MEAL_FIELDS = new Set(["date", "time", "type", "name", "calories", "protein", "fat", "carbs", "memo"]);
const WEIGHT_FIELDS = new Set(["weight", "weightKg", "bodyWeight"]);
const HEALTH_FIELDS = new Set([...MEAL_FIELDS, ...WEIGHT_FIELDS]);
const PRIVATE_KEY_FIELDS = new Set(["d", "p", "q", "dp", "dq", "qi", "oth", "privateKey", "k"]);
const PRIVATE_KEY_OPS = new Set(["decrypt", "sign", "unwrapKey", "deriveKey", "deriveBits"]);
const RSA_MODULUS_BYTES = new Set([256, 384, 512]);

const MAX_ERRORS = 40;

function base64UrlByteLength(value) {
  if (typeof value !== "string" || !BASE64URL_RE.test(value)) return null;
  return Buffer.from(value, "base64url").length;
}

function isSafeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

function quotedToken(value) {
  return isSafeToken(value) ? ` "${value}"` : "";
}

function pathSegment(key) {
  return isSafeToken(key) ? key : "?";
}

function scanValue(value, pointer, errors) {
  if (typeof value === "string") {
    if (PRIVATE_KEY_TEXT_RE.test(value)) errors.push(`${pointer}: 秘密鍵らしい文字列`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${pointer}/${index}`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    const child = `${pointer}/${pathSegment(key)}`;
    if (HEALTH_FIELDS.has(key)) errors.push(`${child}: 平文の健康記録の項目${quotedToken(key)}`);
    else if (PRIVATE_KEY_FIELDS.has(key)) errors.push(`${child}: 秘密鍵らしい項目${quotedToken(key)}`);
    scanValue(value[key], child, errors);
  }
}

function unexpectedKeys(value, allowed, pointer, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (allowed.has(key) || HEALTH_FIELDS.has(key) || PRIVATE_KEY_FIELDS.has(key)) continue;
    errors.push(`${pointer}/${pathSegment(key)}: 想定外の項目${quotedToken(key)}`);
  }
}

function validatePublicKey(key, pointer, errors) {
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    errors.push(`${pointer}: 公開鍵の形が違います`);
    return null;
  }
  unexpectedKeys(key, PUBLIC_KEY_KEYS, pointer, errors);
  if (key.kty !== "RSA") errors.push(`${pointer}: kty は RSA である必要があります`);
  if (key.alg !== "RSA-OAEP-256") errors.push(`${pointer}: alg は RSA-OAEP-256 である必要があります`);
  if (key.ext !== true) errors.push(`${pointer}: ext は true である必要があります`);
  const modulusBytes = base64UrlByteLength(key.n);
  if (!RSA_MODULUS_BYTES.has(modulusBytes)) errors.push(`${pointer}: 公開鍵の modulus の長さが違います`);
  const exponentBytes = base64UrlByteLength(key.e);
  if (exponentBytes == null || exponentBytes < 1 || exponentBytes > 4) {
    errors.push(`${pointer}: 公開鍵の exponent の長さが違います`);
  }
  const ops = key.key_ops;
  if (!Array.isArray(ops) || ops.length !== 1 || ops[0] !== "encrypt") {
    const secretOp = Array.isArray(ops) ? ops.find((op) => PRIVATE_KEY_OPS.has(op)) : null;
    if (secretOp) errors.push(`${pointer}: 秘密鍵らしい操作${quotedToken(secretOp)}`);
    else errors.push(`${pointer}: key_ops は encrypt だけである必要があります`);
  }
  return modulusBytes;
}

export function validateDeviceDocument(doc, filename) {
  const errors = [];
  const pointer = `codex-devices/${filename}`;
  scanValue(doc, pointer, errors);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    errors.push(`${pointer}: オブジェクトである必要があります`);
    return { errors, deviceId: null, modulusBytes: null };
  }
  unexpectedKeys(doc, DEVICE_KEYS, pointer, errors);
  if (doc.version !== 1) errors.push(`${pointer}: version は 1 である必要があります`);
  const stem = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  if (typeof doc.deviceId !== "string" || !DEVICE_ID_RE.test(doc.deviceId) || doc.deviceId !== stem) {
    errors.push(`${pointer}: deviceId がファイル名と一致しません`);
  }
  const modulusBytes = validatePublicKey(doc.publicKey, `${pointer}/publicKey`, errors);
  return { errors, deviceId: typeof doc.deviceId === "string" ? doc.deviceId : null, modulusBytes };
}

function validateEntry(entry, pointer, deviceId, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${pointer}: エンベロープの形が違います`);
    return null;
  }
  unexpectedKeys(entry, ENTRY_KEYS, pointer, errors);
  if (typeof entry.id !== "string" || !DEVICE_ID_RE.test(entry.id)) errors.push(`${pointer}: id の形が違います`);
  if (entry.deviceId !== deviceId) errors.push(`${pointer}: deviceId が受け取り箱と一致しません`);
  const encryptedKeyBytes = base64UrlByteLength(entry.encryptedKey);
  if (!RSA_MODULUS_BYTES.has(encryptedKeyBytes)) errors.push(`${pointer}: encryptedKey の長さが違います`);
  if (base64UrlByteLength(entry.iv) !== 12) errors.push(`${pointer}: iv は 12 バイトである必要があります`);
  const ciphertextBytes = base64UrlByteLength(entry.ciphertext);
  if (ciphertextBytes == null || ciphertextBytes < 16 || ciphertextBytes > 16384) {
    errors.push(`${pointer}: ciphertext の形が違います`);
  }
  return encryptedKeyBytes;
}

export function validateInboxDocument(doc, filename) {
  const errors = [];
  const pointer = `codex-inbox/${filename}`;
  scanValue(doc, pointer, errors);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    errors.push(`${pointer}: オブジェクトである必要があります`);
    return { errors, deviceId: null, encryptedKeyBytes: [] };
  }
  unexpectedKeys(doc, INBOX_KEYS, pointer, errors);
  if (doc.version !== 1) errors.push(`${pointer}: version は 1 である必要があります`);
  const stem = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  if (typeof doc.deviceId !== "string" || !DEVICE_ID_RE.test(doc.deviceId) || doc.deviceId !== stem) {
    errors.push(`${pointer}: deviceId がファイル名と一致しません`);
  }
  const encryptedKeyBytes = [];
  if (!Array.isArray(doc.entries)) {
    errors.push(`${pointer}: entries は配列である必要があります`);
  } else {
    const seen = new Set();
    doc.entries.forEach((entry, index) => {
      const keyBytes = validateEntry(entry, `${pointer}/entries/${index}`, doc.deviceId, errors);
      if (keyBytes != null) encryptedKeyBytes.push(keyBytes);
      if (entry && typeof entry.id === "string") {
        if (seen.has(entry.id)) errors.push(`${pointer}/entries/${index}: id が重複しています`);
        seen.add(entry.id);
      }
    });
  }
  return { errors, deviceId: typeof doc.deviceId === "string" ? doc.deviceId : null, encryptedKeyBytes };
}

function readJsonFiles(root, directory) {
  const dirPath = join(root, directory);
  let names;
  try {
    names = readdirSync(dirPath);
  } catch {
    return { dirError: `${directory}: ディレクトリがありません`, files: [] };
  }
  const files = [];
  for (const name of names) {
    const fullPath = join(dirPath, name);
    const info = statSync(fullPath);
    if (!info.isFile() || !name.endsWith(".json")) {
      files.push({ name, error: `${directory}/${name}: 想定外のファイルです` });
      continue;
    }
    try {
      files.push({ name, json: JSON.parse(readFileSync(fullPath, "utf8")) });
    } catch {
      files.push({ name, error: `${directory}/${name}: JSON として読めません` });
    }
  }
  return { dirError: null, files };
}

export function validateCodexTree(root) {
  const errors = [];
  const devices = readJsonFiles(root, "codex-devices");
  const inboxes = readJsonFiles(root, "codex-inbox");
  if (devices.dirError) errors.push(devices.dirError);
  if (inboxes.dirError) errors.push(inboxes.dirError);

  const modulusByDevice = new Map();
  const deviceIds = new Set();
  for (const file of devices.files) {
    if (file.error) {
      errors.push(file.error);
      continue;
    }
    const result = validateDeviceDocument(file.json, file.name);
    errors.push(...result.errors);
    if (result.deviceId && !result.errors.some((error) => error.includes("deviceId がファイル名と一致しません"))) {
      deviceIds.add(result.deviceId);
    }
    if (result.deviceId && RSA_MODULUS_BYTES.has(result.modulusBytes)) {
      modulusByDevice.set(result.deviceId, result.modulusBytes);
    }
  }

  for (const file of inboxes.files) {
    if (file.error) {
      errors.push(file.error);
      continue;
    }
    const result = validateInboxDocument(file.json, file.name);
    errors.push(...result.errors);
    const knownDevice = result.deviceId != null && deviceIds.has(result.deviceId);
    const filenameMatches = !result.errors.some((error) => error.includes("deviceId がファイル名と一致しません"));
    if (result.deviceId && filenameMatches && !knownDevice) {
      errors.push(`codex-inbox/${file.name}: 対応する公開鍵ファイルがありません`);
    }
    const modulusBytes = result.deviceId ? modulusByDevice.get(result.deviceId) : null;
    if (modulusBytes != null) {
      result.encryptedKeyBytes.forEach((keyBytes, index) => {
        if (keyBytes !== modulusBytes) {
          errors.push(`codex-inbox/${file.name}/entries/${index}: encryptedKey の長さが公開鍵と一致しません`);
        }
      });
    }
  }

  return [...new Set(errors)].slice(0, MAX_ERRORS);
}

function main() {
  const root = process.argv[2] || process.cwd();
  const errors = validateCodexTree(root);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Codex inbox files passed.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
