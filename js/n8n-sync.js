/* ==========================================================================
   n8n経由の体重自動取り込み(任意機能)
   ==========================================================================
   仕組み:
   - iPhoneの「ショートカット」自動化が、Apple Healthの最新体重を
     n8nのWebhook(POST)に送信 → n8nがData Tableに保存
   - このスクリプトは、n8nの別のWebhook(GET)を定期的に叩いて記録一覧を取得し、
     まだこのアプリに存在しない日付だけを体重ログに追加する(「隙間を埋める」方式)
   - 手動でこのアプリ上で入力・編集した記録は上書きしない(常にアプリ側が優先)

   同じ仕組みで「食事」も取り込む(fetchMealsFromN8n)。こちらはチャットで
   調べてもらった外食メニューなどの栄養を、n8nのData Table経由で受け取って
   手入力なしで記録に追加するためのもの。体重と違い1日に何件も入るため、
   日付ではなく n8n の行ID で重複を判定する。取り込み済みのIDを覚えておく
   ことで、アプリ側で削除した記録が次の取得で復活しないようにしている。

   取得用URL(トークンを含む)は、公開リポジトリのコードには一切含めず、
   ユーザーがブラウザ内(localStorage)にのみ保存する。
   ========================================================================== */

const N8N_URL_KEY = "yoshi-n8n-fetch-url";
const N8N_MEAL_URL_KEY = "yoshi-n8n-meal-url";
// 体重・食事ログのうち n8n から取り込んだものに付ける印(手入力の記録と区別するため)
const N8N_SOURCE = "n8n";
let n8nFetchInFlight = false;
let n8nMealFetchInFlight = false;

function readStoredUrl(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

function getN8nFetchUrl() {
  return readStoredUrl(N8N_URL_KEY);
}

function getN8nMealUrl() {
  return readStoredUrl(N8N_MEAL_URL_KEY);
}

function setN8nStatus(text) {
  const el = document.getElementById("n8nStatusText");
  if (el) el.textContent = text;
}

function setN8nMealStatus(text) {
  const el = document.getElementById("n8nMealStatusText");
  if (el) el.textContent = text;
}

function initN8nSync() {
  const urlInput = document.getElementById("n8nFetchUrl");
  const saveBtn = document.getElementById("n8nSaveUrlBtn");
  const fetchBtn = document.getElementById("n8nFetchNowBtn");
  if (!urlInput || !saveBtn || !fetchBtn) return;

  const saved = getN8nFetchUrl();
  if (saved) {
    urlInput.value = saved;
    setN8nStatus("設定済みです。自動で定期的に取得します。");
  } else {
    setN8nStatus("未設定です。URLを貼り付けて保存してください。");
  }

  saveBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    try {
      localStorage.setItem(N8N_URL_KEY, url);
    } catch (e) {
      toast("保存に失敗しました");
      return;
    }
    toast(url ? "保存しました" : "URLを削除しました");
    if (url) fetchFromN8n(true);
    else setN8nStatus("未設定です。URLを貼り付けて保存してください。");
  });

  fetchBtn.addEventListener("click", () => fetchFromN8n(true));

  initN8nMealSync();

  if (saved) fetchFromN8n(false);

  // Poll fairly aggressively while the app is open/visible so a weigh-in
  // shows up as soon as possible after the iPhone side posts it — but pause
  // entirely while backgrounded so it doesn't run forever in a hidden tab.
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (getN8nFetchUrl()) fetchFromN8n(false);
    if (getN8nMealUrl()) fetchMealsFromN8n(false);
  }, 20000); // 20秒ごと(表示中のみ)

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (getN8nFetchUrl()) fetchFromN8n(false);
    if (getN8nMealUrl()) fetchMealsFromN8n(false);
  });
}

// 食事の取り込み(設定タブのURL欄・ボタンの配線)。体重側と同じ形にしてある。
function initN8nMealSync() {
  const urlInput = document.getElementById("n8nMealUrl");
  const saveBtn = document.getElementById("n8nMealSaveBtn");
  const fetchBtn = document.getElementById("n8nMealFetchBtn");
  if (!urlInput || !saveBtn || !fetchBtn) return;

  const saved = getN8nMealUrl();
  if (saved) {
    urlInput.value = saved;
    setN8nMealStatus("設定済みです。自動で定期的に取得します。");
  } else {
    setN8nMealStatus("未設定です。URLを貼り付けて保存してください。");
  }

  saveBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    try {
      localStorage.setItem(N8N_MEAL_URL_KEY, url);
    } catch (e) {
      toast("保存に失敗しました");
      return;
    }
    toast(url ? "保存しました" : "URLを削除しました");
    if (url) fetchMealsFromN8n(true);
    else setN8nMealStatus("未設定です。URLを貼り付けて保存してください。");
  });

  fetchBtn.addEventListener("click", () => fetchMealsFromN8n(true));

  if (saved) fetchMealsFromN8n(false);
}

async function fetchMealsFromN8n(showToast) {
  const url = getN8nMealUrl();
  if (!url || n8nMealFetchInFlight) return;
  n8nMealFetchInFlight = true;
  setN8nMealStatus("取得中...");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected response shape");

    // 取り込み済みの行IDの控え。アプリ側で削除した記録を復活させないため、
    // 「今ある食事記録」ではなく「一度でも取り込んだID」で判定する。
    const imported = new Set((state.importedMealIds || []).map(String));
    let added = 0;
    rows.forEach((row) => {
      if (!row || row.id === undefined || row.id === null) return;
      const rowId = String(row.id);
      if (imported.has(rowId)) return;

      const name = (row.name || "").toString().trim();
      if (!name) return;

      state.meals.push({
        id: uid(),
        date: (row.date || todayStr()).toString().slice(0, 10),
        time: (row.time || "").toString().slice(0, 5),
        type: (row.type || "間食").toString(),
        name,
        calories: Number(row.calories) || 0,
        protein: Number(row.protein) || 0,
        fat: Number(row.fat) || 0,
        carbs: Number(row.carbs) || 0,
        memo: (row.memo || "").toString(),
        photo: null,
        source: N8N_SOURCE,
      });
      imported.add(rowId);
      added++;
    });

    if (added > 0) {
      state.importedMealIds = [...imported];
      saveState();
      renderAll();
      if (showToast) toast(`食事を${added}件取り込みました`);
    } else if (showToast) {
      toast("新しい食事はありませんでした");
    }
    setN8nMealStatus(`最終取得: ${nowTimeStr()}(追加${added}件)`);
  } catch (e) {
    console.error("n8n meal fetch failed", e);
    setN8nMealStatus("取得に失敗しました。URLを確認してください。");
    if (showToast) toast("取得に失敗しました");
  } finally {
    n8nMealFetchInFlight = false;
  }
}

async function fetchFromN8n(showToast) {
  const url = getN8nFetchUrl();
  if (!url || n8nFetchInFlight) return;
  n8nFetchInFlight = true;
  setN8nStatus("取得中...");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected response shape");

    // 日付ごとに「n8n から取り込んだ記録」だけを引けるようにしておく。手入力の
    // 記録(1日に何度でも残せる)は対象にしない。日付だけで引くと、その日すでに
    // 手入力の記録があるときにn8nの分が引っかかって取り込まれなくなるため。
    const byDateFromN8n = new Map(
      state.weightLogs.filter((l) => l.source === N8N_SOURCE).map((l) => [l.date, l])
    );
    let added = 0;
    let updated = 0;
    rows.forEach((row) => {
      const date = row && row.date;
      const weight = row && Number(row.weight);
      if (!date || !weight) return;

      const existing = byDateFromN8n.get(date);
      if (!existing) {
        // その日にn8n取り込みの記録がまだ無ければ新規に追加する。手入力の記録が
        // 同じ日に既にあっても構わない(体重は1日に何度でも記録できるため)。
        // source を残しておくことで、次回以降この記録がn8n由来かどうかを判定する。
        const entry = { id: uid(), date, weight, source: N8N_SOURCE };
        state.weightLogs.push(entry);
        byDateFromN8n.set(date, entry);
        added++;
        return;
      }

      // 同じ日にn8n取り込みの記録が既にあれば、最新の値で上書きする
      // (体重計で測り直した場合や、以前の取り込みが古い値だった場合のため)。
      if (existing.weight !== weight) {
        existing.weight = weight;
        updated++;
      }
    });

    if (added > 0 || updated > 0) {
      saveState();
      renderAll();
      if (showToast) {
        const parts = [];
        if (added > 0) parts.push(`${added}件を追加`);
        if (updated > 0) parts.push(`${updated}件を更新`);
        toast(`体重を${parts.join("、")}しました`);
      }
    } else if (showToast) {
      toast("新しい記録はありませんでした");
    }
    setN8nStatus(`最終取得: ${nowTimeStr()}(追加${added}件・更新${updated}件)`);
  } catch (e) {
    console.error("n8n fetch failed", e);
    setN8nStatus("取得に失敗しました。URLを確認してください。");
    if (showToast) toast("取得に失敗しました");
  } finally {
    n8nFetchInFlight = false;
  }
}

document.addEventListener("DOMContentLoaded", initN8nSync);
