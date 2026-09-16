/* ==========================================================================
   Codex encrypted meal inbox

   The app generates an RSA-OAEP key pair. Only the private key stays in this
   browser. Codex receives the public key and writes hybrid-encrypted meal
   envelopes to a public GitHub file; the plaintext never enters the repo.
   ========================================================================== */

const CODEX_DEVICE_ID_KEY = "yoshi-codex-device-id-v1";
const CODEX_PUBLIC_KEY_KEY = "yoshi-codex-public-key-v1";
const CODEX_PRIVATE_KEY_KEY = "yoshi-codex-private-key-v1";
const CODEX_INBOX_BASE_URL = "https://raw.githubusercontent.com/YOSHI933549/YOSHI/main/codex-inbox";
const CODEX_POLL_INTERVAL_MS = 20000;

let codexPollInFlight = false;
let codexPollTimer = null;

function codexBase64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function codexBase64UrlDecode(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function codexRandomId(bytes = 16) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return codexBase64UrlEncode(value);
}

function codexStoredJson(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

async function ensureCodexDevice() {
  const deviceId = localStorage.getItem(CODEX_DEVICE_ID_KEY);
  const publicKey = codexStoredJson(CODEX_PUBLIC_KEY_KEY);
  const privateKey = codexStoredJson(CODEX_PRIVATE_KEY_KEY);
  if (deviceId && publicKey && privateKey) return { deviceId, publicKey, privateKey };

  if (!crypto.subtle) throw new Error("Web Crypto is unavailable");
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
  const nextDeviceId = codexRandomId();
  const nextPublicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const nextPrivateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  localStorage.setItem(CODEX_DEVICE_ID_KEY, nextDeviceId);
  localStorage.setItem(CODEX_PUBLIC_KEY_KEY, JSON.stringify(nextPublicKey));
  localStorage.setItem(CODEX_PRIVATE_KEY_KEY, JSON.stringify(nextPrivateKey));
  return { deviceId: nextDeviceId, publicKey: nextPublicKey, privateKey: nextPrivateKey };
}

function codexConnectionCode(device) {
  const json = JSON.stringify({ version: 1, deviceId: device.deviceId, publicKey: device.publicKey });
  return codexBase64UrlEncode(new TextEncoder().encode(json));
}

function setCodexStatus(text, connected = false) {
  const status = document.getElementById("codexSyncStatus");
  const connectionBtn = document.getElementById("codexConnectionBtn");
  const checkBtn = document.getElementById("codexCheckBtn");
  if (status) status.textContent = text;
  if (connectionBtn) connectionBtn.classList.toggle("hidden", connected);
  if (checkBtn) checkBtn.classList.toggle("hidden", !connected);
}

async function copyCodexConnectionCode() {
  try {
    const device = await ensureCodexDevice();
    const code = codexConnectionCode(device);
    try {
      await navigator.clipboard.writeText(code);
      toast("接続コードをコピーしました");
    } catch (error) {
      prompt("この接続コードをコピーしてCodexへ送ってください", code);
    }
    setCodexStatus("コピーした接続コードをCodexへ送ってください。");
  } catch (error) {
    console.error("Codex device setup failed", error);
    setCodexStatus("接続の準備に失敗しました。アプリを開き直してください。");
  }
}

async function decryptCodexMeal(entry, privateJwk) {
  if (!entry || !entry.encryptedKey || !entry.iv || !entry.ciphertext) {
    throw new Error("invalid encrypted envelope");
  }
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
  const rawAesKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    codexBase64UrlDecode(entry.encryptedKey)
  );
  const aesKey = await crypto.subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: codexBase64UrlDecode(entry.iv) },
    aesKey,
    codexBase64UrlDecode(entry.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function codexMealRecord(meal) {
  const date = String(meal.date || "");
  const time = String(meal.time || "");
  const type = String(meal.type || "");
  const name = String(meal.name || "").trim();
  const calories = finiteNonNegative(meal.calories);
  const protein = finiteNonNegative(meal.protein);
  const fat = finiteNonNegative(meal.fat);
  const carbs = finiteNonNegative(meal.carbs);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("invalid time");
  if (!["朝食", "昼食", "夕食", "間食"].includes(type)) throw new Error("invalid meal type");
  if (!name || name.length > 160) throw new Error("invalid name");
  if ([calories, protein, fat, carbs].includes(null)) throw new Error("invalid nutrition");
  return {
    id: uid(),
    date,
    time,
    type,
    name,
    calories,
    protein,
    fat,
    carbs,
    memo: String(meal.memo || "").slice(0, 500),
    photo: null,
    source: "codex-encrypted",
  };
}

async function pollCodexInbox(showToast = false) {
  if (codexPollInFlight || document.visibilityState !== "visible") return;
  codexPollInFlight = true;
  try {
    const device = await ensureCodexDevice();
    const url = `${CODEX_INBOX_BASE_URL}/${device.deviceId}.json?t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) {
      setCodexStatus("初回だけ接続コードをCodexへ送ってください。");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const inbox = await response.json();
    if (!inbox || inbox.version !== 1 || inbox.deviceId !== device.deviceId || !Array.isArray(inbox.entries)) {
      throw new Error("invalid inbox");
    }

    const imported = new Set((state.importedMealIds || []).map(String));
    let added = 0;
    let latestImportedDate = "";
    for (const entry of inbox.entries) {
      const entryId = entry && String(entry.id || "");
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(entryId)) continue;
      if (entry.deviceId !== device.deviceId) continue;
      const receiptId = `codex:${entryId}`;
      if (imported.has(receiptId)) continue;
      try {
        const meal = await decryptCodexMeal(entry, device.privateKey);
        const record = codexMealRecord(meal);
        state.meals.push(record);
        latestImportedDate = record.date;
        imported.add(receiptId);
        added++;
      } catch (error) {
        console.error("Codex meal decrypt failed", error);
      }
    }

    if (added > 0) {
      state.importedMealIds = [...imported];
      saveState();
      const mealsDate = document.getElementById("mealsDate");
      if (mealsDate && latestImportedDate) mealsDate.value = latestImportedDate;
      renderAll();
      switchTab("meals");
      toast(`Codexから食事を${added}件登録しました`);
    } else if (showToast) {
      toast("新しい食事はありません（受信済みです）");
    }
    setCodexStatus("Codexと接続済みです。アプリを開くと自動反映されます。", true);
  } catch (error) {
    console.error("Codex inbox fetch failed", error);
    setCodexStatus("受け取り箱を確認できませんでした。通信環境を確認してください。");
    if (showToast) toast("確認に失敗しました");
  } finally {
    codexPollInFlight = false;
  }
}

async function initCodexSync() {
  const connectionBtn = document.getElementById("codexConnectionBtn");
  const checkBtn = document.getElementById("codexCheckBtn");
  if (!connectionBtn || !checkBtn) return;
  connectionBtn.addEventListener("click", copyCodexConnectionCode);
  checkBtn.addEventListener("click", () => pollCodexInbox(true));
  try {
    await ensureCodexDevice();
    await pollCodexInbox(false);
  } catch (error) {
    console.error("Codex sync init failed", error);
    setCodexStatus("接続の準備に失敗しました。アプリを開き直してください。");
  }
  codexPollTimer = setInterval(() => pollCodexInbox(false), CODEX_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollCodexInbox(false);
  });
}

document.addEventListener("DOMContentLoaded", initCodexSync);
