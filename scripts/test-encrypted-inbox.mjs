import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { encryptMeal } from "./encrypt-meal.mjs";

const { subtle } = webcrypto;

function decode(value) {
  return Buffer.from(value, "base64url");
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
const device = { version: 1, deviceId: "test_device_1234", publicKey };
const meal = {
  date: "2026-01-02",
  time: "12:34",
  type: "昼食",
  name: "暗号化テスト用の食事",
  calories: 500,
  protein: 20,
  fat: 15,
  carbs: 65,
  memo: "実データではありません",
};

const envelope = await encryptMeal(device, meal);
assert.equal(envelope.deviceId, device.deviceId);
assert.match(envelope.id, /^[A-Za-z0-9_-]{8,100}$/);
assert.equal(JSON.stringify(envelope).includes(meal.name), false);

const rawAesKey = await subtle.decrypt({ name: "RSA-OAEP" }, keys.privateKey, decode(envelope.encryptedKey));
const aesKey = await subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, ["decrypt"]);
const plaintext = await subtle.decrypt(
  { name: "AES-GCM", iv: decode(envelope.iv) },
  aesKey,
  decode(envelope.ciphertext)
);
assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), meal);
process.stdout.write("Encrypted inbox round-trip passed.\n");
