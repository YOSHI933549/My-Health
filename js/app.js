/* ==========================================================================
   健康・筋トレ・増量トラッカー
   すべてのデータはブラウザの localStorage にのみ保存されます(サーバーなし)。
   ========================================================================== */

const STORAGE_KEY = "yoshi-health-tracker-v1";
const MEAL_LINK_HASH_PREFIX = "#meal=";

/** @typedef {{height:number age:number gender:string activity:string targetWeight:number surplus:number fatRatio:number}} Profile */

const DEFAULT_STATE = {
  profile: null, // Profile | null
  weightLogs: [], // {id, date, time, weight}  ※timeは後から足したので、古い記録には無い
  meals: [], // {id, date, time, type, name, calories, protein, fat, carbs, memo, photo}
  workouts: [], // {id, date, name, memo}
  // n8n から取り込み済みの食事の行ID。取り込んだ記録をアプリ側で削除しても
  // 次の取得で復活しないように、「もう取り込んだ」ことだけを覚えておく。
  importedMealIds: [],
};

let state = loadState();
let weightChartRange = "all"; // "30" | "90" | "180" | "all"
let calorieChartRange = "all"; // "30" | "90" | "180" | "all"

// -------------------------------------------------------------------------
// Storage
// -------------------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch (e) {
    console.error("state load failed", e);
    return structuredClone(DEFAULT_STATE);
  }
}

// localStorage は1オリジンあたり5MB程度しか無く、食事写真を貯めると先に埋まる。
// 溢れたときに黙って落ちると、画面上は登録済みに見えるのにアプリを開き直すと
// 消えている、という一番たちの悪い壊れ方をするので、
//   1. まず普通に書く
//   2. 失敗したら古い写真から捨てて、入るところまで詰めて書き直す
//      (栄養の数値やメモは消さない。写真より記録本体のほうが大事なので)
//   3. それでも書けなければ、消えるかもしれないことを画面に出したままにする
// という順で粘る。
function saveState() {
  if (writeState()) {
    setSaveErrorBanner(false);
    return;
  }

  const dropped = dropOldestPhotosUntilItFits();
  if (dropped > 0) {
    setSaveErrorBanner(false);
    renderAll();
    toast(`保存容量が一杯のため、古い写真${dropped}枚を削除して保存しました`);
    return;
  }

  setSaveErrorBanner(true);
}

function writeState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // js/sync.js defines this when Google Drive sync is configured & signed in.
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
    return true;
  } catch (e) {
    console.error("state save failed", e);
    return false;
  }
}

// 古い写真から1枚ずつ捨てて、書けるようになった時点で止める。捨てた枚数を返す
// (1枚も捨てられなかった=写真が無いのに溢れている場合は0)。
function dropOldestPhotosUntilItFits() {
  const withPhoto = state.meals
    .filter((m) => m.photo)
    .sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));

  // 全部捨てても書けなかった場合に備えて控えを取る。書けていない以上
  // localStorage 側には写真が残っているので、メモリ側も戻して辻褄を合わせる。
  const backup = withPhoto.map((m) => m.photo);

  let dropped = 0;
  for (const meal of withPhoto) {
    meal.photo = null;
    dropped++;
    if (writeState()) return dropped;
  }

  withPhoto.forEach((m, i) => (m.photo = backup[i]));
  return 0; // 写真以外が原因で溢れている。呼び出し側で警告する
}

// 保存できていないことを消えない帯で出す。トーストだと見逃した時点で
// 「保存されたつもり」に戻ってしまうため。
function setSaveErrorBanner(show) {
  const el = document.getElementById("saveErrorBanner");
  if (el) el.classList.toggle("hidden", !show);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// -------------------------------------------------------------------------
// One-tap meal links
// -------------------------------------------------------------------------
// Codex can put one meal in the URL fragment as base64url-encoded JSON. URL
// fragments are not sent to GitHub Pages, so the meal stays between the chat
// and this browser. Tapping the link is the user's explicit import action.
function decodeBase64UrlJson(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function importMealFromLink() {
  if (!location.hash.startsWith(MEAL_LINK_HASH_PREFIX)) return false;

  // Remove the payload immediately so it is not left in browser history or
  // accidentally imported again by a reload.
  const encoded = location.hash.slice(MEAL_LINK_HASH_PREFIX.length);
  history.replaceState(null, "", location.pathname + location.search);

  try {
    if (!encoded || encoded.length > 6000) throw new Error("invalid payload size");
    const meal = decodeBase64UrlJson(encoded);
    const importId = String(meal.importId || "").trim();
    const name = String(meal.name || "").trim();
    const date = String(meal.date || "");
    const time = String(meal.time || "");
    const type = String(meal.type || "");
    const calories = finiteNonNegative(meal.calories);
    const protein = finiteNonNegative(meal.protein);
    const fat = finiteNonNegative(meal.fat);
    const carbs = finiteNonNegative(meal.carbs);

    if (!/^[A-Za-z0-9_-]{8,100}$/.test(importId)) throw new Error("invalid import id");
    if (!name || name.length > 160) throw new Error("invalid name");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("invalid time");
    if (!["朝食", "昼食", "夕食", "間食"].includes(type)) throw new Error("invalid meal type");
    if ([calories, protein, fat, carbs].includes(null)) throw new Error("invalid nutrition");

    const receiptId = `link:${importId}`;
    const imported = new Set((state.importedMealIds || []).map(String));
    if (imported.has(receiptId)) {
      setTimeout(() => toast("この食事は登録済みです"), 0);
      return false;
    }

    state.meals.push({
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
      source: "codex-link",
    });
    imported.add(receiptId);
    state.importedMealIds = [...imported];
    saveState();
    setTimeout(() => toast(`${type}を登録しました`), 0);
    return true;
  } catch (error) {
    console.error("meal link import failed", error);
    setTimeout(() => toast("登録リンクを読み込めませんでした"), 0);
    return false;
  }
}

function mealPayloadFromText(text) {
  const match = String(text || "").match(/#meal=([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

async function importMealFromClipboard() {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    // iOS may deny clipboard access until the user explicitly pastes.
  }

  let encoded = mealPayloadFromText(text);
  if (!encoded) {
    const pasted = prompt("Codexの登録リンクを貼り付けてください");
    if (!pasted) return;
    encoded = mealPayloadFromText(pasted);
  }
  if (!encoded) {
    toast("登録リンクを確認してください");
    return;
  }

  location.hash = `${MEAL_LINK_HASH_PREFIX}${encoded}`;
  const imported = importMealFromLink();
  if (imported) {
    renderAll();
    switchTab("meals");
  }
}

// -------------------------------------------------------------------------
// Date helpers
// -------------------------------------------------------------------------
function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// Format a Date object as a local YYYY-MM-DD string (no UTC conversion —
// unlike todayStr(), this is meant for dates already constructed in local time).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// -------------------------------------------------------------------------
// Tabs
// -------------------------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => switchTab(el.dataset.goto));
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  if (tab === "dashboard") renderDashboard();
  if (tab === "meals") renderMeals();
  if (tab === "workouts") renderWorkouts();
  if (tab === "weight") renderWeight();
  if (tab === "settings") renderSettings();
}

// -------------------------------------------------------------------------
// Nutrition target calculation
// -------------------------------------------------------------------------
// 体重は1日に何度でも記録できるので、日付だけでなく時刻まで見て並べる。
// 時刻を持たない古い記録は、その日の先頭として扱う。
function weightSortKey(log) {
  return `${log.date} ${log.time || "00:00"}`;
}

function sortedWeightLogs() {
  return [...state.weightLogs].sort((a, b) => weightSortKey(a).localeCompare(weightSortKey(b)));
}

function getWeightAsOf(dateStr) {
  const logs = sortedWeightLogs();
  if (logs.length === 0) return null;
  const upTo = logs.filter((l) => l.date <= dateStr);
  if (upTo.length > 0) return upTo[upTo.length - 1];
  return logs[0]; // fallback: earliest known if date is before any log
}

function getLatestWeight() {
  const logs = sortedWeightLogs();
  return logs.length ? logs[logs.length - 1] : null;
}

// カロリー推移グラフの目標線用。体重と違って目標カロリーは体重が変わるたびに
// 動くので、過去の日付ごとに遡って計算するのではなく「直近の体重での現在の
// 目標」を一本の目安線として表示する(体重の目標線と同じ考え方)。
function currentTargetCalories() {
  const latest = getLatestWeight();
  const targets = state.profile && latest ? computeTargets(state.profile, latest.weight) : null;
  return targets ? targets.calories : null;
}

function computeTargets(profile, weightKg) {
  if (!profile || !weightKg) return null;
  const { height, age, gender, activity, surplus, fatRatio } = profile;
  const bmr =
    gender === "female"
      ? 10 * weightKg + 6.25 * height - 5 * age - 161
      : 10 * weightKg + 6.25 * height - 5 * age + 5;
  const tdee = bmr * Number(activity);
  const targetCalories = tdee + Number(surplus || 0);
  const proteinG = weightKg * 2;
  const proteinCal = proteinG * 4;
  const fatCal = targetCalories * (Number(fatRatio || 25) / 100);
  const fatG = fatCal / 9;
  const carbCal = Math.max(0, targetCalories - proteinCal - fatCal);
  const carbG = carbCal / 4;
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories: Math.round(targetCalories),
    protein: Math.round(proteinG),
    fat: Math.round(fatG),
    carb: Math.round(carbG),
  };
}

// -------------------------------------------------------------------------
// Dashboard
// -------------------------------------------------------------------------
function initDashboard() {
  const dateInput = document.getElementById("dashboardDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderDashboard);
}

function renderDashboard() {
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  const notice = document.getElementById("noProfileNotice");
  const content = document.getElementById("dashboardContent");

  const weightEntry = getWeightAsOf(dateStr);
  const targets = state.profile && weightEntry ? computeTargets(state.profile, weightEntry.weight) : null;

  if (!targets) {
    notice.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  notice.classList.add("hidden");
  content.classList.remove("hidden");

  const dayMeals = state.meals.filter((m) => m.date === dateStr);
  const totals = dayMeals.reduce(
    (acc, m) => {
      acc.calories += Number(m.calories) || 0;
      acc.protein += Number(m.protein) || 0;
      acc.fat += Number(m.fat) || 0;
      acc.carbs += Number(m.carbs) || 0;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  renderMacroCards(totals, targets);
  renderWeightChart("weightChart", state.weightLogs, 30);
  renderCalorieChart("calorieChart", mealDailyTotals(), 30, targets.calories);

  // Today's meals
  const mealsListEl = document.getElementById("todayMealsList");
  mealsListEl.innerHTML = dayMeals.length
    ? dayMeals.map((m) => mealItemHTML(m, false)).join("")
    : `<div class="empty-state">この日の食事記録はまだありません。「食事」タブから追加してください。</div>`;

  // Today's workouts
  const dayWorkouts = state.workouts.filter((w) => w.date === dateStr);
  const workoutListEl = document.getElementById("todayWorkoutList");
  workoutListEl.innerHTML = dayWorkouts.length
    ? dayWorkouts.map((w) => workoutItemHTML(w, false)).join("")
    : `<div class="empty-state">この日のトレーニング記録はまだありません。「筋トレ」タブから追加してください。</div>`;
}

// 4つの栄養素(カロリー/たんぱく質/脂質/炭水化物)を、同じ大きさのリング
// ゲージで並べる。色の役割(cal=橙, protein=緑, fat=紫, carb=青)は据え置き。
const MACRO_RING_COLOR_VAR = {
  cal: "--accent-orange",
  protein: "--primary",
  fat: "--accent-purple",
  carb: "--accent-blue",
};

function macroRingCardHTML(cls, label, value, target, unit) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = target > 0 && value > target;
  return `
  <div class="macro-ring-card ${cls}">
    <div class="ring-gauge-sm" style="--pct:${pct}; --ring-color:var(${MACRO_RING_COLOR_VAR[cls]})">
      <div class="rg-value">${pct}<small>%</small></div>
    </div>
    <div class="mrc-label">${label}</div>
    <div class="mrc-value${over ? " over" : ""}">${over ? "🔥 " : ""}${Math.round(value)}/${target}${unit}</div>
  </div>`;
}

function renderMacroCards(totals, targets) {
  const el = document.getElementById("macroCards");
  el.innerHTML =
    macroRingCardHTML("cal", "カロリー", totals.calories, targets.calories, "kcal") +
    macroRingCardHTML("protein", "たんぱく質", totals.protein, targets.protein, "g") +
    macroRingCardHTML("fat", "脂質", totals.fat, targets.fat, "g") +
    macroRingCardHTML("carb", "炭水化物", totals.carbs, targets.carb, "g");
}

// -------------------------------------------------------------------------
// Meals
// -------------------------------------------------------------------------
function initMeals() {
  const dateInput = document.getElementById("mealsDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderMeals);

  document.getElementById("calorieRangeGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    calorieChartRange = btn.dataset.range;
    document
      .querySelectorAll("#calorieRangeGroup .range-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderMeals();
  });

  document.getElementById("mealTime").value = nowTimeStr();
  document.getElementById("importMealClipboardBtn").addEventListener("click", importMealFromClipboard);

  // 材料を複数選んで「＋ 材料に追加」で積み上げ、合計をカロリー・PFC欄に自動反映する
  const foodPreset = document.getElementById("mealFoodPreset");
  const foodGrams = document.getElementById("mealFoodGrams");
  const foodGramsField = document.getElementById("mealFoodGramsField");
  const foodGramsLabel = document.getElementById("mealFoodGramsLabel");
  const foodServingsField = document.getElementById("mealFoodServingsField");
  const foodServingsBtns = document.getElementById("mealFoodServings");
  const foodAddBtn = document.getElementById("mealFoodAddBtn");
  const foodChips = document.getElementById("mealFoodChips");
  const foodHint = document.getElementById("mealFoodHint");
  const nameInput = document.getElementById("mealName");
  const caloriesInput = document.getElementById("mealCalories");
  const proteinInput = document.getElementById("mealProtein");
  const fatInput = document.getElementById("mealFat");
  const carbsInput = document.getElementById("mealCarbs");

  let ingredients = []; // [{name, qty, unitLabel, kcal, protein, fat, carbs}]
  let lastAutoName = ""; // メニュー名を自動入力した内容を覚えておき、ユーザーが手動で書き換えていなければ更新し続ける

  // プロテインなど「毎回決まった量(例: 15g/30g)しか使わない」食品は、
  // data-servings で指定された量だけをボタンで選ばせ、自由なg数入力をさせない。
  // 食パンなど「g数ではなく枚数・個数で数える」食品は data-unit="count" +
  // data-unit-label(例: 枚)を持たせ、入力欄のラベル・単位を切り替える
  // (g数の代わりに枚数を入力し、100gあたりではなく1枚あたりの値で計算する)
  function updateFoodInputMode() {
    const opt = foodPreset.selectedOptions[0];
    const servings = opt && opt.dataset.servings ? opt.dataset.servings.split(",").map(Number) : null;
    const unitLabel = (opt && opt.dataset.unitLabel) || "g";
    foodGrams.value = "";
    if (servings) {
      foodGramsField.classList.add("hidden");
      foodServingsField.classList.remove("hidden");
      foodServingsBtns.innerHTML = servings
        .map((g) => `<button type="button" class="serving-btn" data-g="${g}">${g}${unitLabel}</button>`)
        .join("");
    } else {
      foodGramsField.classList.remove("hidden");
      foodServingsField.classList.add("hidden");
      foodServingsBtns.innerHTML = "";
      const isCount = opt && opt.dataset.unit === "count";
      foodGramsLabel.textContent = isCount ? `${unitLabel}数` : "g数";
      foodGrams.placeholder = isCount ? "例: 1" : "例: 100";
    }
  }

  foodPreset.addEventListener("change", updateFoodInputMode);

  foodServingsBtns.addEventListener("click", (e) => {
    const btn = e.target.closest(".serving-btn");
    if (!btn) return;
    foodGrams.value = btn.dataset.g;
    foodServingsBtns.querySelectorAll(".serving-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });

  function renderFoodChips() {
    foodChips.classList.toggle("hidden", ingredients.length === 0);
    foodChips.innerHTML = ingredients
      .map(
        (ing, i) =>
          `<span class="food-chip">${escapeHTML(ing.name)} ${ing.qty}${ing.unitLabel}<button type="button" data-i="${i}" title="削除">✕</button></span>`
      )
      .join("");
  }

  function recalcFromIngredients() {
    if (ingredients.length === 0) {
      foodHint.hidden = true;
      return;
    }
    const totals = ingredients.reduce(
      (sum, ing) => ({
        kcal: sum.kcal + ing.kcal,
        protein: sum.protein + ing.protein,
        fat: sum.fat + ing.fat,
        carbs: sum.carbs + ing.carbs,
      }),
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );
    const kcal = Math.round(totals.kcal);
    const protein = Math.round(totals.protein * 10) / 10;
    const fat = Math.round(totals.fat * 10) / 10;
    const carbs = Math.round(totals.carbs * 10) / 10;
    caloriesInput.value = kcal;
    proteinInput.value = protein;
    fatInput.value = fat;
    carbsInput.value = carbs;
    const autoName = ingredients.map((ing) => `${ing.name}${ing.qty}${ing.unitLabel}`).join(" + ");
    if (!nameInput.value.trim() || nameInput.value === lastAutoName) nameInput.value = autoName;
    lastAutoName = autoName;
    foodHint.hidden = false;
    foodHint.textContent = `材料${ingredients.length}点の合計 → ${kcal}kcal / P${protein}g / F${fat}g / C${carbs}g(下の欄で微調整できます)`;
  }

  foodAddBtn.addEventListener("click", () => {
    const opt = foodPreset.selectedOptions[0];
    const qty = Number(foodGrams.value);
    if (!opt || !opt.value) {
      toast("食品を選択してください");
      return;
    }
    if (!qty) {
      toast(opt.dataset.unit === "count" ? `${opt.dataset.unitLabel || ""}数を入力してください` : "g数を入力してください");
      return;
    }
    // g数で数える食品は100gあたり、個数・枚数などで数える食品は1個(1枚)あたりの
    // データを保持しているので、それぞれ ÷100 / ÷1 で倍率を出す
    const unitLabel = opt.dataset.unit === "count" ? opt.dataset.unitLabel || "個" : "g";
    const ratio = opt.dataset.unit === "count" ? qty : qty / 100;
    ingredients.push({
      name: opt.value,
      qty,
      unitLabel,
      kcal: Number(opt.dataset.kcal) * ratio,
      protein: Number(opt.dataset.protein) * ratio,
      fat: Number(opt.dataset.fat) * ratio,
      carbs: Number(opt.dataset.carbs) * ratio,
    });
    renderFoodChips();
    recalcFromIngredients();
    foodPreset.value = "";
    updateFoodInputMode();
  });

  foodChips.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    ingredients.splice(Number(btn.dataset.i), 1);
    renderFoodChips();
    recalcFromIngredients();
  });

  const photoInput = document.getElementById("mealPhoto");
  const preview = document.getElementById("mealPhotoPreview");
  let pendingPhoto = null;

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) {
      pendingPhoto = null;
      preview.classList.add("hidden");
      return;
    }
    try {
      pendingPhoto = await resizeImageToDataURL(file, 480, 0.7);
      preview.src = pendingPhoto;
      preview.classList.remove("hidden");
    } catch (e) {
      console.error(e);
      toast("写真の読み込みに失敗しました");
    }
  });

  document.getElementById("mealForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const meal = {
      id: uid(),
      date: dateInput.value || todayStr(),
      time: document.getElementById("mealTime").value || nowTimeStr(),
      type: document.getElementById("mealType").value,
      name: document.getElementById("mealName").value.trim(),
      calories: Number(document.getElementById("mealCalories").value) || 0,
      protein: Number(document.getElementById("mealProtein").value) || 0,
      fat: Number(document.getElementById("mealFat").value) || 0,
      carbs: Number(document.getElementById("mealCarbs").value) || 0,
      memo: document.getElementById("mealMemo").value.trim(),
      photo: pendingPhoto,
    };
    if (!meal.name) return;
    state.meals.push(meal);
    saveState();
    e.target.reset();
    document.getElementById("mealTime").value = nowTimeStr();
    pendingPhoto = null;
    preview.classList.add("hidden");
    ingredients = [];
    lastAutoName = "";
    renderFoodChips();
    updateFoodInputMode();
    foodHint.hidden = true;
    renderMeals();
    toast("食事を記録しました");
  });

  document.getElementById("mealsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    deleteWithUndo("meals", btn.dataset.id, renderMeals, "食事の記録");
  });
}

// 区分(朝食/昼食/夕食/間食)ごとにタグの色分けクラスを振る
const MEAL_TYPE_TAG_CLASS = {
  朝食: "meal-breakfast",
  昼食: "meal-lunch",
  夕食: "meal-dinner",
  間食: "meal-snack",
};

function mealItemHTML(m, withDelete = true) {
  const macros = `
    <span>🔥 ${m.calories}kcal</span>
    <span>P ${m.protein}g</span>
    ${m.fat ? `<span>F ${m.fat}g</span>` : ""}
    ${m.carbs ? `<span>C ${m.carbs}g</span>` : ""}`;
  const tagClass = MEAL_TYPE_TAG_CLASS[m.type] || "";
  return `
  <div class="list-item">
    ${m.photo ? `<img src="${m.photo}" alt="">` : ""}
    <div class="info">
      <div class="title-row">
        <span class="name">${escapeHTML(m.name)}</span>
        <span class="tag ${tagClass}">${m.type}</span>
      </div>
      <div class="meta">${fmtDate(m.date)} ${m.time || ""}${m.memo ? " ・ " + escapeHTML(m.memo) : ""}</div>
      <div class="macros">${macros}</div>
    </div>
    ${withDelete ? `<button class="del" data-id="${m.id}" title="削除">✕</button>` : ""}
  </div>`;
}

function renderMeals() {
  const dateStr = document.getElementById("mealsDate").value || todayStr();
  const items = state.meals
    .filter((m) => m.date === dateStr)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const el = document.getElementById("mealsList");
  el.innerHTML = items.length
    ? items.map((m) => mealItemHTML(m, true)).join("")
    : `<div class="empty-state">この日の記録はまだありません。</div>`;

  // カロリー推移グラフは選択中の日付に関わらず記録全体の推移を見せるもの
  // (体重タブのグラフ・履歴が日付選択と無関係なのと同じ考え方)
  const dailyTotals = mealDailyTotals();
  renderCalorieTrend(dailyTotals);
  const days = calorieChartRange === "all" ? null : Number(calorieChartRange);
  renderCalorieChart("calorieChartFull", dailyTotals, days, currentTargetCalories());
}

function resizeImageToDataURL(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// -------------------------------------------------------------------------
// Workouts
// -------------------------------------------------------------------------
function initWorkouts() {
  const dateInput = document.getElementById("workoutsDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderWorkouts);

  const exerciseSelect = document.getElementById("exerciseSelect");
  const customField = document.getElementById("exerciseCustomField");
  const customInput = document.getElementById("exerciseCustomName");

  exerciseSelect.addEventListener("change", () => {
    const isCustom = exerciseSelect.value === "__custom__";
    customField.classList.toggle("hidden", !isCustom);
    if (isCustom) customInput.focus();
  });

  initExercisePicker(exerciseSelect);
  initWorkoutCalendar();

  document.getElementById("workoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name =
      exerciseSelect.value === "__custom__" ? customInput.value.trim() : exerciseSelect.value;

    const workout = {
      id: uid(),
      date: dateInput.value || todayStr(),
      name,
      memo: document.getElementById("workoutMemo").value.trim(),
    };
    if (!workout.name) {
      if (exerciseSelect.value === "__custom__") customInput.focus();
      return;
    }
    state.workouts.push(workout);
    saveState();
    e.target.reset();
    customField.classList.add("hidden");
    exerciseSelect.dispatchEvent(new Event("change")); // 種目ピッカーの表示(アイコン・名前)を先頭の種目に戻す
    renderWorkouts();
    toast("トレーニングを記録しました");
  });

  document.getElementById("workoutsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    deleteWithUndo("workouts", btn.dataset.id, renderWorkouts, "トレーニングの記録");
  });
}

// 種目名の横に小さい絵(線画アイコン)をつけた一覧から種目を選べるようにする。
// 種目リストの実体は index.html の <select id="exerciseSelect"> のまま(隠して残す)にして、
// そこから読み取って見た目だけを作る。値の保存や他の処理は今まで通り exerciseSelect(隠しselect)が担当する。
function initExercisePicker(nativeSelect) {
  const picker = document.getElementById("exercisePicker");
  const btn = document.getElementById("exercisePickerBtn");
  const btnIcon = document.getElementById("exercisePickerIcon");
  const btnLabel = document.getElementById("exercisePickerLabel");
  const panel = document.getElementById("exercisePickerPanel");
  if (!picker || !btn || !panel) return;

  const iconFor = (value) =>
    (value === "__custom__" ? window.EXERCISE_ICON_CUSTOM : window.EXERCISE_ICONS && window.EXERCISE_ICONS[value]) ||
    "";

  let panelHTML = "";
  Array.from(nativeSelect.children).forEach((node) => {
    if (node.tagName === "OPTGROUP") {
      panelHTML += `<div class="exercise-group-label">${escapeHTML(node.label)}</div>`;
      Array.from(node.children).forEach((opt) => (panelHTML += exerciseOptionHTML(opt)));
    } else if (node.tagName === "OPTION") {
      panelHTML += exerciseOptionHTML(node);
    }
  });
  panel.innerHTML = panelHTML;

  function exerciseOptionHTML(opt) {
    const isCustom = opt.value === "__custom__";
    return `
    <button type="button" class="exercise-option${isCustom ? " is-custom" : ""}" data-value="${escapeHTML(opt.value)}">
      <span class="exercise-option-icon">${iconFor(opt.value)}</span>
      <span class="exercise-option-label">${escapeHTML(opt.textContent)}</span>
    </button>`;
  }

  function syncButtonFromSelect() {
    const opt = nativeSelect.selectedOptions[0];
    btnIcon.innerHTML = opt ? iconFor(opt.value) : "";
    btnLabel.textContent = opt ? opt.textContent : "種目を選択";
  }

  function openPanel() {
    panel.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    panel.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => {
    panel.classList.contains("hidden") ? openPanel() : closePanel();
  });

  panel.addEventListener("click", (e) => {
    const optBtn = e.target.closest(".exercise-option");
    if (!optBtn) return;
    nativeSelect.value = optBtn.dataset.value;
    nativeSelect.dispatchEvent(new Event("change"));
    closePanel();
  });

  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target)) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  // 隠しselectの値が変わったら(一覧からのクリック・フォームリセットどちらでも)ボタン表示を追従させる
  nativeSelect.addEventListener("change", syncButtonFromSelect);
  syncButtonFromSelect();
}

function workoutItemHTML(w, withDelete = true) {
  return `
  <div class="list-item">
    <div class="info">
      <div class="title-row">
        <span class="name">${escapeHTML(w.name)}</span>
      </div>
      <div class="meta">${fmtDate(w.date)}${w.memo ? " ・ " + escapeHTML(w.memo) : ""}</div>
    </div>
    ${withDelete ? `<button class="del" data-id="${w.id}" title="削除">✕</button>` : ""}
  </div>`;
}

function renderWorkouts() {
  const dateStr = document.getElementById("workoutsDate").value || todayStr();
  renderPrevWorkoutHint(dateStr);
  renderWorkoutCalendar();
  const items = state.workouts.filter((w) => w.date === dateStr);
  const el = document.getElementById("workoutsList");
  el.innerHTML = items.length
    ? items.map((w) => workoutItemHTML(w, true)).join("")
    : `<div class="empty-state">この日の記録はまだありません。</div>`;
}

// 選択中の日付より前で、直近にトレーニングを記録した日の種目を小さく表示する。
// 「今日は何をやったか忘れた/前回と同じ部位を続けて避けたい」を一目で確認できるように。
function renderPrevWorkoutHint(dateStr) {
  const el = document.getElementById("prevWorkoutHint");
  if (!el) return;
  const priorDates = [...new Set(state.workouts.filter((w) => w.date < dateStr).map((w) => w.date))].sort();
  const lastDate = priorDates[priorDates.length - 1];
  if (!lastDate) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const names = [...new Set(state.workouts.filter((w) => w.date === lastDate).map((w) => w.name))];
  el.classList.remove("hidden");
  el.innerHTML = `<span>前回(${fmtDate(lastDate)})</span><b>${names.map(escapeHTML).join("・")}</b>`;
}

// --- 筋トレカレンダー -----------------------------------------------------
// 「どの日に何をやったか」を月表示で一目で追えるようにする。セルには部位を1文字
// (胸・背・脚…)の文字で出し、正確な種目名は日付をタップして下の「記録一覧」で
// 見る、という二段構えにしている。スマホ幅だとセルが40px前後しか無く、種目名を
// そのまま並べると読めないため。
// 色は上半身/下半身の2色だけ。部位ごとに7色を並べるとチカチカして、肝心の
// 「どの日にやったか」が読み取りにくかったため。体幹・その他はどちらにも寄せず
// 無彩色にしてある。

// 部位 -> 上半身/下半身。体幹・腹筋とその他はどちらでもないので無彩色(neutral)。
const WORKOUT_GROUP_BODY = {
  "胸": "upper",
  "背中": "upper",
  "肩": "upper",
  "腕": "upper",
  "脚": "lower",
};

const WORKOUT_GROUP_SHORT = {
  "胸": "胸",
  "背中": "背",
  "脚": "脚",
  "肩": "肩",
  "腕": "腕",
  "体幹・腹筋": "腹",
  "その他": "他",
};

let workoutCalMonth = null; // 表示中の月 "YYYY-MM"

// 部位はexerciseMuscleGroup()(selectのoptgroupが出どころ)を使う。
// 自由入力の種目は部位が無いので、カレンダー上では「その他」にまとめる。
function exerciseGroupOf(name) {
  return exerciseMuscleGroup(name) || "その他";
}

function initWorkoutCalendar() {
  const grid = document.getElementById("wcalGrid");
  if (!grid) return;

  document.getElementById("wcalPrev").addEventListener("click", () => shiftWorkoutCalMonth(-1));
  document.getElementById("wcalNext").addEventListener("click", () => shiftWorkoutCalMonth(1));
  document.getElementById("wcalToday").addEventListener("click", () => selectWorkoutDate(todayStr()));

  grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".wcal-day");
    if (!cell || !cell.dataset.date) return;
    selectWorkoutDate(cell.dataset.date);
  });
}

function shiftWorkoutCalMonth(delta) {
  const base = workoutCalMonth || todayStr().slice(0, 7);
  const [y, m] = base.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  workoutCalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  renderWorkoutCalendar();
}

// カレンダーの日付タップ = 記録日の選択。フォームの日付とも連動させて、
// そのまま種目を追記できるようにする。
function selectWorkoutDate(dateStr) {
  const input = document.getElementById("workoutsDate");
  if (input) input.value = dateStr;
  workoutCalMonth = dateStr.slice(0, 7);
  renderWorkouts();
}

function renderWorkoutCalendar() {
  const grid = document.getElementById("wcalGrid");
  if (!grid) return;

  const selected = document.getElementById("workoutsDate").value || todayStr();
  if (!workoutCalMonth) workoutCalMonth = selected.slice(0, 7);
  const [y, m] = workoutCalMonth.split("-").map(Number);
  document.getElementById("wcalTitle").textContent = `${y}年${m}月`;

  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = new Date(y, m - 1, 1).getDay();
  const today = todayStr();

  const byDate = {};
  state.workouts.forEach((w) => {
    if (!w.date || w.date.slice(0, 7) !== workoutCalMonth) return;
    (byDate[w.date] = byDate[w.date] || []).push(w.name);
  });

  const usedGroups = [];
  let html = "";
  for (let i = 0; i < lead; i++) html += `<div class="wcal-blank"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const names = byDate[dateStr] || [];
    const groups = [...new Set(names.map(exerciseGroupOf))];
    groups.forEach((g) => {
      if (!usedGroups.includes(g)) usedGroups.push(g);
    });

    const shown = groups.slice(0, 3);
    const chips =
      shown
        .map(
          (g) =>
            `<span class="wcal-chip body-${WORKOUT_GROUP_BODY[g] || "neutral"}">${escapeHTML(
              WORKOUT_GROUP_SHORT[g] || "他"
            )}</span>`
        )
        .join("") +
      (groups.length > shown.length ? `<span class="wcal-chip is-more">+${groups.length - shown.length}</span>` : "");

    const dow = new Date(y, m - 1, d).getDay();
    const cls = ["wcal-day"];
    if (names.length) cls.push("has-log");
    if (dateStr === selected) cls.push("is-selected");
    if (dateStr === today) cls.push("is-today");
    if (dow === 0) cls.push("is-sun");
    if (dow === 6) cls.push("is-sat");

    const label = names.length ? `${fmtDate(dateStr)} ${names.join("・")}` : `${fmtDate(dateStr)} 記録なし`;
    html += `
    <button type="button" class="${cls.join(" ")}" data-date="${dateStr}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"${dateStr === selected ? ' aria-current="date"' : ""}>
      <span class="wcal-dnum">${d}</span>
      <span class="wcal-chips">${chips}</span>
    </button>`;
  }
  grid.innerHTML = html;

  const summaryEl = document.getElementById("wcalSummary");
  if (summaryEl) {
    const days = Object.keys(byDate).length;
    summaryEl.textContent = days ? `この月のトレーニング ${days}日` : "この月の記録はまだありません";
  }
}

// -------------------------------------------------------------------------
// Weight
// -------------------------------------------------------------------------
function initWeight() {
  document.getElementById("weightDate").value = todayStr();
  document.getElementById("weightTime").value = nowTimeStr();

  document.getElementById("weightForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("weightDate").value || todayStr();
    const time = document.getElementById("weightTime").value || nowTimeStr();
    const weight = Number(document.getElementById("weightValue").value);
    if (!weight) return;
    // 同じ日でも時刻が違えば別の記録として残す(朝晩それぞれ量れるように)。
    // 同じ日時への記録だけは、打ち間違いの訂正とみなして上書きする。
    const existing = state.weightLogs.find((l) => l.date === date && (l.time || "") === time);
    if (existing) {
      existing.weight = weight;
    } else {
      state.weightLogs.push({ id: uid(), date, time, weight });
    }
    saveState();
    e.target.reset();
    document.getElementById("weightDate").value = todayStr();
    document.getElementById("weightTime").value = nowTimeStr();
    renderWeight();
    toast("体重を記録しました");
  });

  document.getElementById("weightList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    deleteWithUndo("weightLogs", btn.dataset.id, renderWeight, "体重の記録");
  });

  document.getElementById("weightRangeGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    weightChartRange = btn.dataset.range;
    document
      .querySelectorAll("#weightRangeGroup .range-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderWeight();
  });
}

function renderWeightTrend(logs) {
  const el = document.getElementById("weightTrend");
  const sorted = [...logs].sort((a, b) => weightSortKey(a).localeCompare(weightSortKey(b)));
  if (sorted.length === 0) {
    el.innerHTML = "";
    return;
  }
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const diff = +(latest.weight - first.weight).toFixed(1);
  const diffClass = diff > 0 ? "up" : diff < 0 ? "down" : "";
  const diffText = diff === 0 ? "±0kg" : diff > 0 ? `+${diff}kg` : `${diff}kg`;

  // 「現在」の体重はグラフ内の見出しボックスにも出るため、ここでは重複させない
  const parts = [
    `<span>記録開始 ${first.weight}kg(${fmtDate(first.date)})</span>`,
    `<span>増減 <b class="${diffClass}">${diffText}</b></span>`,
    `<span>記録数 ${sorted.length}件</span>`,
  ];

  // 1日に複数回量った日があると、グラフの値(その日の平均)と履歴の値が食い違って
  // 見えるので、そのときだけ理由を添える。
  const daysWithMultiple = new Set(
    sorted.map((l) => l.date).filter((d, i, arr) => arr.indexOf(d) !== i)
  ).size;
  if (daysWithMultiple > 0) {
    parts.push(`<span>グラフは1日の平均</span>`);
  }

  const targetWeight = state.profile && state.profile.targetWeight;
  if (targetWeight) {
    const remain = +(targetWeight - latest.weight).toFixed(1);
    parts.push(
      `<span>目標 ${targetWeight}kg まで ${remain > 0 ? `あと ${remain}kg` : "達成 🎉"}</span>`
    );
  }

  el.innerHTML = parts.join("");
}

function renderWeight() {
  const sorted = sortedWeightLogs().reverse();
  const el = document.getElementById("weightList");
  el.innerHTML = sorted.length
    ? sorted
        .map((l, i) => {
          const prev = sorted[i + 1];
          const diff = prev ? +(l.weight - prev.weight).toFixed(1) : null;
          const diffText =
            diff === null ? "" : diff === 0 ? "±0" : diff > 0 ? `+${diff}kg` : `${diff}kg`;
          return `
        <div class="list-item">
          <div class="info">
            <div class="title-row">
              <span class="name">${l.weight}kg</span>
              <span class="tag">${fmtDate(l.date)}${l.time ? " " + l.time : ""}</span>
            </div>
            ${diffText ? `<div class="meta">前回比 ${diffText}</div>` : ""}
          </div>
          <button class="del" data-id="${l.id}" title="削除">✕</button>
        </div>`;
        })
        .join("")
    : `<div class="empty-state">まだ体重の記録がありません。</div>`;

  renderWeightTrend(state.weightLogs);
  const days = weightChartRange === "all" ? null : Number(weightChartRange);
  renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
}

// 体重・カロリーどちらの推移グラフも見た目とロジックは同じ(値と目標値が違うだけ)
// なので、実際の描画はここに1本化してある。それぞれの呼び出し元(renderWeightChart/
// renderCalorieChart)が「値をどう文字にするか」だけを opts で渡す。
// points: [{date: "YYYY-MM-DD", value: number}, ...](順不同でよい)
function renderLineChart(canvasId, points, days, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let windowed = sorted;
  if (days && sorted.length > 0) {
    const anchor = new Date(sorted[sorted.length - 1].date + "T00:00:00");
    anchor.setDate(anchor.getDate() - days);
    const cutoff = anchor.toISOString().slice(0, 10);
    windowed = sorted.filter((p) => p.date >= cutoff);
    if (windowed.length < 2 && sorted.length >= 2) windowed = sorted.slice(-2); // always show a line if 2+ records exist
  }
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  // The intended on-screen height is captured once. Assigning `canvas.height`
  // below rewrites the height attribute to the device-pixel size, so re-reading
  // that attribute on a later re-draw would multiply the height by the device
  // pixel ratio again and again — on a 3x phone the chart grew taller every
  // time the dashboard re-rendered.
  if (!canvas.dataset.baseHeight) {
    canvas.dataset.baseHeight = String(Number(canvas.getAttribute("height")) || 140);
  }
  const cssHeight = Number(canvas.dataset.baseHeight);
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  // The stylesheet only sets `width: 100%`, so without an explicit CSS height
  // the element lays out at the device-pixel height (2-3x too tall).
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#1f7a5c";
  const muted = styles.getPropertyValue("--text-muted").trim() || "#888";
  const border = styles.getPropertyValue("--border").trim() || "#ddd";
  const text = styles.getPropertyValue("--text").trim() || "#1a2420";
  const surfaceAlt = styles.getPropertyValue("--surface-alt").trim() || "#eef3ee";
  const orange = styles.getPropertyValue("--accent-orange").trim() || "#e0793a";

  if (windowed.length === 0) {
    ctx.fillStyle = muted;
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillText(opts.noDataText, 8, cssHeight / 2);
    return;
  }
  if (windowed.length === 1) {
    ctx.fillStyle = muted;
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillText(opts.singlePointText(windowed[0].value, windowed[0].date), 8, cssHeight / 2);
    return;
  }

  // Headline (current value + date) as a single compact line at the top-left.
  // A boxed callout used to sit here, but it plus its padding ate roughly half
  // of the canvas height, squeezing the line chart itself into the remainder.
  // Plain text keeps the "where am I now" answer while leaving the vertical
  // space to the part that actually shows the trend.
  const latest = windowed[windowed.length - 1];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = text;
  ctx.font = "bold 15px 'Share Tech Mono', monospace";
  const headline = opts.headline(latest.value);
  ctx.fillText(headline, 8, 14);
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.fillStyle = muted;
  ctx.fillText(fmtDate(latest.date), 8 + ctx.measureText(headline).width + 22, 14);

  const padL = 8;
  const padR = 36;
  const padT = 24;
  const padB = 20;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  const values = windowed.map((p) => p.value);
  if (opts.targetValue) values.push(Number(opts.targetValue));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;

  const x = (i) => padL + (plotW * i) / (windowed.length - 1);
  const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

  // horizontal gridlines + y-axis labels on the right
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.lineWidth = 1;
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const val = min + ((max - min) * i) / gridLines;
    const yy = y(val);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(cssWidth - padR, yy);
    ctx.stroke();
    ctx.fillText(opts.axisLabel(val), cssWidth - padR + 6, yy + 3);
  }

  // dashed vertical gridlines + evenly-spaced date labels along the bottom
  const labelCount = Math.min(5, windowed.length);
  const labelIndices = [...new Set(
    Array.from({ length: labelCount }, (_, i) =>
      labelCount === 1 ? 0 : Math.round((i * (windowed.length - 1)) / (labelCount - 1))
    )
  )];
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = border;
  labelIndices.forEach((i) => {
    const px = x(i);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
  });
  ctx.restore();

  ctx.fillStyle = muted;
  ctx.font = "10px 'Share Tech Mono', monospace";
  labelIndices.forEach((i, idx) => {
    const label = fmtDate(windowed[i].date);
    const w = ctx.measureText(label).width;
    let tx = x(i) - w / 2;
    if (idx === 0) tx = Math.max(tx, padL);
    if (idx === labelIndices.length - 1) tx = Math.min(tx, cssWidth - padR - w);
    ctx.fillText(label, tx, cssHeight - 4);
  });

  // target reference line
  if (opts.targetValue) {
    const ty = y(Number(opts.targetValue));
    ctx.save();
    ctx.strokeStyle = orange;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, ty);
    ctx.lineTo(cssWidth - padR, ty);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = orange;
    ctx.fillText(opts.targetLabel(opts.targetValue), padL + 4, ty - 4);
  }

  // smoothed line path (quadratic curve through the midpoints of each
  // segment), reused for both the stroke and the gradient fill below it
  const linePath = new Path2D();
  windowed.forEach((p, i) => {
    const px = x(i);
    const py = y(p.value);
    if (i === 0) {
      linePath.moveTo(px, py);
    } else {
      const prevX = x(i - 1);
      const prevY = y(windowed[i - 1].value);
      const midX = (prevX + px) / 2;
      const midY = (prevY + py) / 2;
      linePath.quadraticCurveTo(prevX, prevY, midX, midY);
      linePath.quadraticCurveTo(midX, midY, px, py);
    }
  });

  // soft gradient fill under the line to give it some depth
  const fillPath = new Path2D(linePath);
  fillPath.lineTo(x(windowed.length - 1), padT + plotH);
  fillPath.lineTo(x(0), padT + plotH);
  fillPath.closePath();
  const gradient = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  gradient.addColorStop(0, color_mix_fallback(primary, 0.22));
  gradient.addColorStop(1, color_mix_fallback(primary, 0));
  ctx.fillStyle = gradient;
  ctx.fill(fillPath);

  ctx.strokeStyle = primary;
  ctx.lineWidth = 2.25;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(linePath);

  // points — open circles (colored ring, light fill) rather than solid dots,
  // with the latest point drawn larger and solid to draw the eye to "now"
  windowed.forEach((p, i) => {
    const isLast = i === windowed.length - 1;
    ctx.beginPath();
    ctx.arc(x(i), y(p.value), isLast ? 4.5 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = isLast ? primary : surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary;
    ctx.stroke();
  });
}

// createLinearGradient wants real rgba() stops, but our CSS vars are hex —
// this fakes an alpha-blended color without pulling in a color-parsing lib.
function color_mix_fallback(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 1日に何度も量ると同じ日に複数の記録が並ぶので、グラフはその日の平均を1点として
// 描く。横軸が日付である以上、朝と晩を別の点として打っても線が上下に震えるだけで、
// 肝心の増減の傾きが読めなくなるため。
function dailyAverageWeights(logs) {
  const byDate = {};
  logs.forEach((l) => {
    (byDate[l.date] = byDate[l.date] || []).push(l.weight);
  });
  return Object.entries(byDate).map(([date, weights]) => ({
    date,
    value: +(weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(1),
  }));
}

function renderWeightChart(canvasId, logs, days, targetWeight) {
  renderLineChart(
    canvasId,
    dailyAverageWeights(logs),
    days,
    {
      targetValue: targetWeight,
      targetLabel: (v) => `目標 ${v}kg`,
      headline: (v) => `${v}kg`,
      axisLabel: (v) => v.toFixed(1),
      noDataText: "体重の記録がありません",
      singlePointText: (v, date) => `${v}kg (${fmtDate(date)}) — 記録を増やすとグラフが表示されます`,
    }
  );
}

// 食事記録から日ごとの合計カロリーを集計する({date, calories}の配列。複数食を合算)
function mealDailyTotals() {
  const byDate = {};
  state.meals.forEach((m) => {
    byDate[m.date] = (byDate[m.date] || 0) + (Number(m.calories) || 0);
  });
  return Object.entries(byDate).map(([date, calories]) => ({ date, calories }));
}

function renderCalorieChart(canvasId, dailyTotals, days, targetCalories) {
  renderLineChart(
    canvasId,
    dailyTotals.map((d) => ({ date: d.date, value: d.calories })),
    days,
    {
      targetValue: targetCalories,
      targetLabel: (v) => `目標 ${Math.round(v)}kcal`,
      headline: (v) => `${Math.round(v)}kcal`,
      axisLabel: (v) => String(Math.round(v)),
      noDataText: "カロリーの記録がありません",
      singlePointText: (v, date) => `${Math.round(v)}kcal (${fmtDate(date)}) — 記録を増やすとグラフが表示されます`,
    }
  );
}

function renderCalorieTrend(dailyTotals) {
  const el = document.getElementById("calorieTrend");
  if (!el) return;
  const sorted = [...dailyTotals].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) {
    el.innerHTML = "";
    return;
  }
  const latest = sorted[sorted.length - 1];
  const avg = Math.round(sorted.reduce((sum, d) => sum + d.calories, 0) / sorted.length);

  const parts = [
    `<span>直近 ${Math.round(latest.calories)}kcal(${fmtDate(latest.date)})</span>`,
    `<span>期間平均 ${avg}kcal</span>`,
    `<span>記録日数 ${sorted.length}日</span>`,
  ];

  const targetCalories = currentTargetCalories();
  if (targetCalories) {
    const diff = avg - targetCalories;
    const diffClass = diff > 0 ? "up" : diff < 0 ? "down" : "";
    const diffText = diff === 0 ? "±0kcal" : diff > 0 ? `+${diff}kcal` : `${diff}kcal`;
    parts.push(`<span>目標比(平均) <b class="${diffClass}">${diffText}</b></span>`);
  }

  el.innerHTML = parts.join("");
}

// 種目名 -> 部位(胸/背中/脚/…)。種目リストの実体である
// <select id="exerciseSelect"> の optgroup から引くので、二重管理にならない。
// 自由入力の種目は対応する部位が無いので null。
let exerciseGroupMap = null;
function exerciseMuscleGroup(name) {
  if (!exerciseGroupMap) {
    exerciseGroupMap = {};
    document.querySelectorAll("#exerciseSelect optgroup").forEach((g) => {
      Array.from(g.children).forEach((opt) => {
        exerciseGroupMap[opt.value] = g.label;
      });
    });
  }
  return exerciseGroupMap[name] || null;
}

// -------------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------------
function initSettings() {
  document.getElementById("profileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.profile = {
      height: Number(document.getElementById("height").value),
      age: Number(document.getElementById("age").value),
      gender: document.getElementById("gender").value,
      activity: document.getElementById("activity").value,
      targetWeight: Number(document.getElementById("targetWeight").value) || null,
      surplus: Number(document.getElementById("surplus").value) || 0,
      fatRatio: Number(document.getElementById("fatRatio").value) || 25,
    };
    saveState();
    renderSettings();
    toast("プロフィールを保存しました");
  });

  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importInput").addEventListener("change", importData);
  document.getElementById("resetBtn").addEventListener("click", resetAllData);
  document.getElementById("hardRefreshBtn").addEventListener("click", hardRefreshApp);
}

// Manual escape hatch for a stuck/stale cached version: unregister the
// service worker, clear every Cache Storage entry it made, then reload.
// Deliberately does NOT touch localStorage — the user's recorded data (and
// the yoshi-sync-enabled flag) survive this untouched.
async function hardRefreshApp() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("hard refresh cleanup failed", e);
  } finally {
    toast("更新しています...");
    location.reload();
  }
}

function renderSettings() {
  const p = state.profile;
  if (p) {
    document.getElementById("height").value = p.height ?? "";
    document.getElementById("age").value = p.age ?? "";
    document.getElementById("gender").value = p.gender ?? "male";
    document.getElementById("activity").value = p.activity ?? "1.55";
    document.getElementById("targetWeight").value = p.targetWeight ?? "";
    document.getElementById("surplus").value = p.surplus ?? 400;
    document.getElementById("fatRatio").value = p.fatRatio ?? 25;
  }

  const summaryEl = document.getElementById("targetSummary");
  const latest = getLatestWeight();
  const targets = p && latest ? computeTargets(p, latest.weight) : null;

  if (!targets) {
    summaryEl.innerHTML = `<div class="empty-state">プロフィールと体重(「体重」タブ)を入力すると、ここに1日の目標が表示されます。</div>`;
    return;
  }

  summaryEl.innerHTML = `
    <div class="ts-item"><div class="k">基準体重</div><div class="v">${latest.weight}kg</div></div>
    <div class="ts-item"><div class="k">基礎代謝(BMR)</div><div class="v">${targets.bmr}kcal</div></div>
    <div class="ts-item"><div class="k">消費カロリー(TDEE)</div><div class="v">${targets.tdee}kcal</div></div>
    <div class="ts-item"><div class="k">摂取目標カロリー</div><div class="v">${targets.calories}kcal</div></div>
    <div class="ts-item"><div class="k">たんぱく質(体重×2)</div><div class="v">${targets.protein}g</div></div>
    <div class="ts-item"><div class="k">脂質</div><div class="v">${targets.fat}g</div></div>
    <div class="ts-item"><div class="k">炭水化物</div><div class="v">${targets.carb}g</div></div>
    ${p.targetWeight ? `<div class="ts-item"><div class="k">目標体重</div><div class="v">${p.targetWeight}kg</div></div>` : ""}
  `;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `health-tracker-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("エクスポートしました");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm("現在のデータを上書きしてインポートします。よろしいですか?")) return;
      state = { ...structuredClone(DEFAULT_STATE), ...data };
      saveState();
      renderAll();
      toast("インポートしました");
    } catch (err) {
      console.error(err);
      toast("インポートに失敗しました(ファイル形式を確認してください)");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

function resetAllData() {
  if (!confirm("すべての記録(食事・トレーニング・体重・プロフィール)を削除します。元に戻せません。よろしいですか?")) return;
  if (!confirm("本当によろしいですか? この操作は取り消せません。")) return;
  state = structuredClone(DEFAULT_STATE);
  saveState();
  renderAll();
  toast("すべてのデータを削除しました");
}

// -------------------------------------------------------------------------
// Toast
// -------------------------------------------------------------------------
let toastTimer = null;

// onUndo を渡すと「元に戻す」ボタン付きになり、表示時間も長めになる。
function toast(msg, onUndo) {
  const el = document.getElementById("toast");
  el.textContent = "";
  el.append(msg);

  if (onUndo) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-undo";
    btn.textContent = "元に戻す";
    btn.addEventListener("click", () => {
      el.classList.add("hidden");
      clearTimeout(toastTimer);
      onUndo();
    });
    el.append(btn);
  }

  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), onUndo ? 6000 : 2400);
}

// -------------------------------------------------------------------------
// 取り消せる削除
// -------------------------------------------------------------------------
// 削除の確認ダイアログは出さない。毎回「はい」を押させても誤操作は防げず、
// 押した後に戻せないことのほうが困るので、すぐ消して数秒だけ取り消せるようにする。
// 消した位置に戻すのは、並び順が記録順に依存する箇所があるため。
function deleteWithUndo(listName, id, rerender, label) {
  const list = state[listName];
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return;
  const [removed] = list.splice(index, 1);

  saveState();
  rerender();

  toast(`${label}を削除しました`, () => {
    state[listName].splice(index, 0, removed);
    saveState();
    rerender();
    toast(`${label}を元に戻しました`);
  });
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderWeight();
  renderSettings();
}

function init() {
  initTabs();
  initDashboard();
  initMeals();
  initWorkouts();
  initWeight();
  initSettings();
  const mealImported = importMealFromLink();
  renderAll();
  if (mealImported) switchTab("meals");
  window.addEventListener("resize", () => {
    renderWeightChart("weightChart", state.weightLogs, 30);
    const days = weightChartRange === "all" ? null : Number(weightChartRange);
    renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
    const dailyTotals = mealDailyTotals();
    renderCalorieChart("calorieChart", dailyTotals, 30, currentTargetCalories());
    const calorieDays = calorieChartRange === "all" ? null : Number(calorieChartRange);
    renderCalorieChart("calorieChartFull", dailyTotals, calorieDays, currentTargetCalories());
  });
}

document.addEventListener("DOMContentLoaded", init);

// Register the service worker so the app can be added to the home screen
// and keeps working offline (all data lives in localStorage already; this
// just caches the app shell itself). Safe to skip if unsupported (e.g. file://).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => reg.update().catch(() => {})) // check for a newer sw.js on every load
      .catch((err) => console.warn("Service worker registration failed:", err));

    // When a new service worker takes over (after an update), reload once so
    // the page picks up the latest index.html/js/css instead of staying on
    // whatever was loaded before the update. Guarded so it only fires once.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  });
}
