import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const MEAL_TYPES = new Set(["朝食", "昼食", "夕食", "間食"]);

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function validatedNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return number;
}

export function validateDevice(device) {
  if (!device || device.version !== 1) throw new Error("Unsupported device file");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(device.deviceId || ""))) {
    throw new Error("Invalid deviceId");
  }
  if (!device.publicKey || device.publicKey.kty !== "RSA" || device.publicKey.alg !== "RSA-OAEP-256") {
    throw new Error("Invalid RSA-OAEP-256 public key");
  }
  return device;
}

export function validateMeal(meal) {
  const result = {
    date: String(meal?.date || ""),
    time: String(meal?.time || ""),
    type: String(meal?.type || ""),
    name: String(meal?.name || "").trim(),
    calories: validatedNumber(meal?.calories, "calories"),
    protein: validatedNumber(meal?.protein, "protein"),
    fat: validatedNumber(meal?.fat, "fat"),
    carbs: validatedNumber(meal?.carbs, "carbs"),
    memo: String(meal?.memo || "").slice(0, 500),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) throw new Error("Invalid date");
  if (!/^\d{2}:\d{2}$/.test(result.time)) throw new Error("Invalid time");
  if (!MEAL_TYPES.has(result.type)) throw new Error("Invalid meal type");
  if (!result.name || result.name.length > 160) throw new Error("Invalid meal name");
  return result;
}

export async function encryptMeal(deviceInput, mealInput) {
  const device = validateDevice(deviceInput);
  const meal = validateMeal(mealInput);
  const publicKey = await subtle.importKey(
    "jwk",
    device.publicKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(JSON.stringify(meal))
  );
  const rawAesKey = await subtle.exportKey("raw", aesKey);
  const encryptedKey = await subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAesKey);

  return {
    id: base64Url(webcrypto.getRandomValues(new Uint8Array(16))),
    deviceId: device.deviceId,
    encryptedKey: base64Url(encryptedKey),
    iv: base64Url(iv),
    ciphertext: base64Url(ciphertext),
  };
}

async function main() {
  const devicePath = process.argv[2];
  if (!devicePath) throw new Error("Usage: node scripts/encrypt-meal.mjs <device.json> < meal.json");
  const device = JSON.parse(readFileSync(devicePath, "utf8"));
  const meal = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(`${JSON.stringify(await encryptMeal(device, meal), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
