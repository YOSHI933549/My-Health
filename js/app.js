/* ==========================================================================
   健康・筋トレ・増量トラッカー
   すべてのデータはブラウザの localStorage にのみ保存されます(サーバーなし)。
   ========================================================================== */

const STORAGE_KEY = "yoshi-health-tracker-v1";

/** @typedef {{height:number age:number gender:string activity:string targetWeight:number surplus:number fatRatio:number}} Profile */

const DEFAULT_STATE = {
  profile: null, // Profile | null
  weightLogs: [], // {id, date, weight}
  meals: [], // {id, date, time, type, name, calories, protein, fat, carbs, memo, photo}
  workouts: [], // {id, date, name, memo}
  // n8n から取り込み済みの食事の行ID。取り込んだ記録をアプリ側で削除しても
  // 次の取得で復活しないように、「もう取り込んだ」ことだけを覚えておく。
  importedMealIds: [],
};

let state = loadState();
let weightChartRange = "all"; // "30" | "90" | "180" | "all"
let calorieChartRange = "all"; // "30" | "90" | "180" | "all"
let trendRange = "30"; // "7" | "30" | "90" | "all"

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

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // js/sync.js defines this when Google Drive sync is configured & signed in.
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  } catch (e) {
    console.error("state save failed", e);
    toast("保存に失敗しました(容量オーバーの可能性)。写真サイズを減らすか、古い記録を削除してください。");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  if (tab === "trends") renderTrends();
  if (tab === "settings") renderSettings();
}

// -------------------------------------------------------------------------
// Nutrition target calculation
// -------------------------------------------------------------------------
function getWeightAsOf(dateStr) {
  const logs = [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date));
  if (logs.length === 0) return null;
  const upTo = logs.filter((l) => l.date <= dateStr);
  if (upTo.length > 0) return upTo[upTo.length - 1];
  return logs[0]; // fallback: earliest known if date is before any log
}

function getLatestWeight() {
  const logs = [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date));
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

function macroCardHTML(cls, label, value, target, unit) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const over = target > 0 && value > target;
  return `
  <div class="macro-card ${cls}">
    <div class="label"><span>${label}</span><span>${over ? "🔥 " : ""}${Math.round(value)}/${target}${unit}</span></div>
    <div class="value">${pct}<small>%</small></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function renderMacroCards(totals, targets) {
  const el = document.getElementById("macroCards");
  el.innerHTML =
    macroCardHTML("cal", "カロリー", totals.calories, targets.calories, "kcal") +
    macroCardHTML("protein", "たんぱく質", totals.protein, targets.protein, "g") +
    macroCardHTML("fat", "脂質", totals.fat, targets.fat, "g") +
    macroCardHTML("carb", "炭水化物", totals.carbs, targets.carb, "g");
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
    const id = btn.dataset.id;
    if (!confirm("この記録を削除しますか?")) return;
    state.meals = state.meals.filter((m) => m.id !== id);
    saveState();
    renderMeals();
  });
}

function mealItemHTML(m, withDelete = true) {
  const macros = `
    <span>🔥 ${m.calories}kcal</span>
    <span>P ${m.protein}g</span>
    ${m.fat ? `<span>F ${m.fat}g</span>` : ""}
    ${m.carbs ? `<span>C ${m.carbs}g</span>` : ""}`;
  return `
  <div class="list-item">
    ${m.photo ? `<img src="${m.photo}" alt="">` : ""}
    <div class="info">
      <div class="title-row">
        <span class="name">${escapeHTML(m.name)}</span>
        <span class="tag">${m.type}</span>
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
    if (!confirm("この記録を削除しますか?")) return;
    state.workouts = state.workouts.filter((w) => w.id !== btn.dataset.id);
    saveState();
    renderWorkouts();
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

// -------------------------------------------------------------------------
// Weight
// -------------------------------------------------------------------------
function initWeight() {
  document.getElementById("weightDate").value = todayStr();

  document.getElementById("weightForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("weightDate").value || todayStr();
    const weight = Number(document.getElementById("weightValue").value);
    if (!weight) return;
    const existing = state.weightLogs.find((l) => l.date === date);
    if (existing) {
      existing.weight = weight;
    } else {
      state.weightLogs.push({ id: uid(), date, weight });
    }
    saveState();
    e.target.reset();
    document.getElementById("weightDate").value = todayStr();
    renderWeight();
    toast("体重を記録しました");
  });

  document.getElementById("weightList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    if (!confirm("この記録を削除しますか?")) return;
    state.weightLogs = state.weightLogs.filter((l) => l.id !== btn.dataset.id);
    saveState();
    renderWeight();
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
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
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
  const sorted = [...state.weightLogs].sort((a, b) => b.date.localeCompare(a.date));
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
              <span class="tag">${fmtDate(l.date)}</span>
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

  // line
  ctx.beginPath();
  windowed.forEach((p, i) => {
    const px = x(i);
    const py = y(p.value);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  // points — open circles (colored ring, light fill) rather than solid dots
  windowed.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(p.value), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary;
    ctx.stroke();
  });
}

function renderWeightChart(canvasId, logs, days, targetWeight) {
  renderLineChart(
    canvasId,
    logs.map((l) => ({ date: l.date, value: l.weight })),
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

// -------------------------------------------------------------------------
// Trends (rule-based analysis over the recorded data)
// -------------------------------------------------------------------------
function initTrends() {
  document.getElementById("trendRangeGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".range-btn");
    if (!btn) return;
    trendRange = btn.dataset.range;
    document
      .querySelectorAll("#trendRangeGroup .range-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderTrends();
  });
}

// Every calendar date string from the earliest record (or N days back) through today.
function trendPeriodDates(rangeKey) {
  const end = todayStr();
  let startStr;
  if (rangeKey === "all") {
    const allDates = [
      ...state.meals.map((m) => m.date),
      ...state.workouts.map((w) => w.date),
      ...state.weightLogs.map((l) => l.date),
    ];
    startStr = allDates.length ? allDates.reduce((a, b) => (a < b ? a : b)) : end;
  } else {
    const d = new Date(end + "T00:00:00");
    d.setDate(d.getDate() - (Number(rangeKey) - 1));
    startStr = ymd(d);
  }
  const dates = [];
  const cur = new Date(startStr + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (cur <= endD) {
    dates.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// メニュー名から「何を食べたか」を大まかに分類するための言葉。
// カロリー・PFCの「量」だけでは見えない栄養の偏り(野菜・魚・果物が
// 出てこない等)を拾うために使う。完全な判定ではなく傾向の目安。
const FOOD_CATEGORY_KEYWORDS = {
  "野菜": ["野菜", "サラダ", "ブロッコリー", "キャベツ", "レタス", "トマト", "きゅうり", "ほうれん草", "小松菜", "にんじん", "人参", "玉ねぎ", "玉ネギ", "ピーマン", "なす", "ナス", "白菜", "大根", "ごぼう", "アスパラ", "オクラ", "かぼちゃ", "もやし", "きのこ", "キノコ", "しめじ", "えのき", "まいたけ", "しいたけ", "わかめ", "海藻", "ひじき", "味噌汁", "みそ汁"],
  "魚": ["サーモン", "鮭", "まぐろ", "マグロ", "ツナ", "さば", "サバ", "鯖", "いわし", "イワシ", "あじ", "アジ", "ぶり", "ブリ", "たら", "タラ", "えび", "エビ", "いか", "イカ", "魚", "刺身", "寿司", "すし"],
  "肉": ["鶏", "豚", "牛", "肉", "ハム", "ベーコン", "ソーセージ", "ステーキ", "焼肉", "ハンバーグ", "からあげ", "唐揚げ"],
  "卵": ["卵", "たまご", "玉子", "オムレツ", "目玉焼き"],
  "乳製品": ["ヨーグルト", "チーズ", "牛乳", "ミルク"],
  "大豆": ["豆腐", "納豆", "大豆", "豆乳", "枝豆", "厚揚げ", "味噌", "みそ"],
  "果物": ["バナナ", "りんご", "リンゴ", "みかん", "オレンジ", "いちご", "イチゴ", "ぶどう", "キウイ", "果物", "フルーツ", "ブルーベリー"],
  "ナッツ": ["ナッツ", "アーモンド", "くるみ", "クルミ", "カシュー"],
  "主食": ["ごはん", "ご飯", "白米", "玄米", "米", "パン", "麺", "パスタ", "うどん", "そば", "ラーメン", "オートミール", "シリアル", "餅", "もち"],
  "プロテイン": ["プロテイン"],
};

// たんぱく質を摂れる食品グループ(種類が偏っていないかを見る)
const PROTEIN_SOURCE_CATEGORIES = ["肉", "魚", "卵", "乳製品", "大豆", "プロテイン"];

// "HH:MM" -> 分(0-1439)。壊れた/空の時刻はnull
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
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

function allMuscleGroups() {
  return Array.from(document.querySelectorAll("#exerciseSelect optgroup")).map((g) => g.label);
}

function computeTrendMetrics(rangeKey) {
  const dates = trendPeriodDates(rangeKey);

  let loggedMealDays = 0;
  let workoutDays = 0;
  let sumTargetCal = 0;
  let sumActualCal = 0;
  let sumTargetProtein = 0;
  let sumActualProtein = 0;
  let sumTargetFat = 0;
  let sumActualFat = 0;
  let sumTargetCarb = 0;
  let sumActualCarb = 0;
  let targetedDays = 0;
  const weeklyBuckets = []; // [{label, pct}] averaged protein % per 7-day chunk

  // 区分(朝食/昼食/夕食/間食)ごとの平均栄養・平均時刻・記録日数。
  // 「炭水化物が足りないなら、いつ・何を食べれば良いか」の材料にする。
  const mealTypeAgg = {}; // { [type]: {cal, carb, protein, fat, count, days, timeSum, timeCount} }
  const addMealTypeAgg = (m, isFirstOfDay) => {
    const t =
      mealTypeAgg[m.type] ||
      (mealTypeAgg[m.type] = { cal: 0, carb: 0, protein: 0, fat: 0, count: 0, days: 0, timeSum: 0, timeCount: 0 });
    t.cal += Number(m.calories) || 0;
    t.carb += Number(m.carbs) || 0;
    t.protein += Number(m.protein) || 0;
    t.fat += Number(m.fat) || 0;
    t.count++;
    if (isFirstOfDay) t.days++;
    const mins = timeToMinutes(m.time);
    if (mins !== null) {
      t.timeSum += mins;
      t.timeCount++;
    }
  };

  // 何を食べているか(野菜・魚・果物などが食卓に登場した日数)と、
  // メニューの種類数。「量」ではなく「中身」の偏りを見るための材料。
  const foodCatDays = {}; // { [カテゴリ]: 登場した日数 }
  const mealNameSet = new Set();

  // 食事の摂り方(1日の食事回数・最後の食事の時刻・たんぱく質の偏り)
  let mealEntryCount = 0;
  let lastMealMinSum = 0;
  let lastMealMinCount = 0;
  let proteinTopShareSum = 0;
  let proteinTopShareCount = 0;

  // トレーニングした日/しない日で、食事の摂り方に違いがあるか比較する
  let workoutDayCalSum = 0, workoutDayCalCount = 0;
  let restDayCalSum = 0, restDayCalCount = 0;

  // 平日と週末で食事の傾向が変わっていないか
  let weekdayTargetCal = 0, weekdayActualCal = 0, weekdayDays = 0;
  let weekendTargetCal = 0, weekendActualCal = 0, weekendDays = 0;

  // トレーニングの中身(部位の偏り・空いた日数)。
  const muscleGroupCounts = {};
  let longestNoTrainGap = 0;
  let curNoTrainGap = 0;
  let sawWorkoutInPeriod = false;

  let bucketSumPct = 0;
  let bucketCount = 0;
  let bucketStart = dates[0];

  dates.forEach((date, i) => {
    const dayMeals = state.meals.filter((m) => m.date === date);
    const hasMeal = dayMeals.length > 0;
    if (hasMeal) loggedMealDays++;
    const dayWorkouts = state.workouts.filter((w) => w.date === date);
    const isWorkoutDay = dayWorkouts.length > 0;
    if (isWorkoutDay) workoutDays++;

    // 期間中に最も長くトレーニングが空いた日数(最初の1回目より前は数えない)
    if (isWorkoutDay) {
      sawWorkoutInPeriod = true;
      curNoTrainGap = 0;
    } else if (sawWorkoutInPeriod) {
      curNoTrainGap++;
      if (curNoTrainGap > longestNoTrainGap) longestNoTrainGap = curNoTrainGap;
    }

    dayWorkouts.forEach((w) => {
      const group = exerciseMuscleGroup(w.name);
      if (group) muscleGroupCounts[group] = (muscleGroupCounts[group] || 0) + 1;
    });

    const totalCal = dayMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    const totalProtein = dayMeals.reduce((s, m) => s + (Number(m.protein) || 0), 0);
    const totalFat = dayMeals.reduce((s, m) => s + (Number(m.fat) || 0), 0);
    const totalCarb = dayMeals.reduce((s, m) => s + (Number(m.carbs) || 0), 0);

    const seenTypesToday = new Set();
    dayMeals.forEach((m) => {
      const isFirstOfDay = !seenTypesToday.has(m.type);
      seenTypesToday.add(m.type);
      addMealTypeAgg(m, isFirstOfDay);
    });
    mealEntryCount += dayMeals.length;

    // その日の食卓に、どのカテゴリの食品が並んだか
    const dayCats = new Set();
    dayMeals.forEach((m) => {
      const name = m.name || "";
      if (name) mealNameSet.add(name);
      Object.entries(FOOD_CATEGORY_KEYWORDS).forEach(([cat, words]) => {
        if (words.some((w) => name.includes(w))) dayCats.add(cat);
      });
    });
    dayCats.forEach((c) => {
      foodCatDays[c] = (foodCatDays[c] || 0) + 1;
    });

    if (hasMeal) {
      const mins = dayMeals.map((m) => timeToMinutes(m.time)).filter((v) => v !== null);
      if (mins.length > 0) {
        lastMealMinSum += Math.max(...mins); // その日の「最後の食事」の時刻
        lastMealMinCount++;
      }
      if (totalProtein > 0) {
        // たんぱく質が1食に偏っていないか(その日の最大の1食 ÷ 1日合計)
        const topProtein = dayMeals.reduce((mx, m) => Math.max(mx, Number(m.protein) || 0), 0);
        proteinTopShareSum += topProtein / totalProtein;
        proteinTopShareCount++;
      }

      if (isWorkoutDay) {
        workoutDayCalSum += totalCal;
        workoutDayCalCount++;
      } else {
        restDayCalSum += totalCal;
        restDayCalCount++;
      }
    }

    const weightEntry = getWeightAsOf(date);
    const targets = state.profile && weightEntry ? computeTargets(state.profile, weightEntry.weight) : null;

    if (targets && hasMeal) {
      targetedDays++;
      sumTargetCal += targets.calories;
      sumActualCal += totalCal;
      sumTargetProtein += targets.protein;
      sumActualProtein += totalProtein;
      sumTargetFat += targets.fat;
      sumActualFat += totalFat;
      sumTargetCarb += targets.carb;
      sumActualCarb += totalCarb;

      const dow = new Date(date + "T00:00:00").getDay();
      if (dow === 0 || dow === 6) {
        weekendTargetCal += targets.calories;
        weekendActualCal += totalCal;
        weekendDays++;
      } else {
        weekdayTargetCal += targets.calories;
        weekdayActualCal += totalCal;
        weekdayDays++;
      }

      bucketSumPct += (totalProtein / targets.protein) * 100;
      bucketCount++;
    }

    const isWeekEnd = (i + 1) % 7 === 0 || i === dates.length - 1;
    if (isWeekEnd) {
      if (bucketCount > 0) {
        weeklyBuckets.push({ label: `${fmtDate(bucketStart)}〜${fmtDate(date)}`, pct: Math.round(bucketSumPct / bucketCount) });
      }
      bucketSumPct = 0;
      bucketCount = 0;
      bucketStart = dates[i + 1];
    }
  });

  const avgCaloriePct = targetedDays > 0 ? Math.round((sumActualCal / sumTargetCal) * 100) : null;
  const avgProteinPct = targetedDays > 0 ? Math.round((sumActualProtein / sumTargetProtein) * 100) : null;
  const avgFatPct = targetedDays > 0 ? Math.round((sumActualFat / sumTargetFat) * 100) : null;
  const avgCarbPct = targetedDays > 0 ? Math.round((sumActualCarb / sumTargetCarb) * 100) : null;
  const avgCalDiff = targetedDays > 0 ? Math.round(sumTargetCal / targetedDays - sumActualCal / targetedDays) : null;
  const avgProteinDiff =
    targetedDays > 0 ? Math.round(sumTargetProtein / targetedDays - sumActualProtein / targetedDays) : null;

  // 区分ごとの平均値(1回あたり)に変換。時刻は分の平均を「H時台」に丸める
  const mealTypeSummary = {};
  Object.entries(mealTypeAgg).forEach(([type, t]) => {
    mealTypeSummary[type] = {
      count: t.count,
      days: t.days,
      avgCal: t.cal / t.count,
      avgCarb: t.carb / t.count,
      avgProtein: t.protein / t.count,
      avgFat: t.fat / t.count,
      avgHour: t.timeCount > 0 ? Math.round(t.timeSum / t.timeCount / 60) % 24 : null,
    };
  });

  const totalTypeCal = Object.values(mealTypeAgg).reduce((s, t) => s + t.cal, 0);
  const snackCalShare =
    totalTypeCal > 0 ? Math.round(((mealTypeAgg["間食"] ? mealTypeAgg["間食"].cal : 0) / totalTypeCal) * 100) : null;

  const avgCalWorkoutDay = workoutDayCalCount > 0 ? Math.round(workoutDayCalSum / workoutDayCalCount) : null;
  const avgCalRestDay = restDayCalCount > 0 ? Math.round(restDayCalSum / restDayCalCount) : null;
  const avgMealsPerDay = loggedMealDays > 0 ? +(mealEntryCount / loggedMealDays).toFixed(1) : null;
  const avgLastMealHour = lastMealMinCount > 0 ? +(lastMealMinSum / lastMealMinCount / 60).toFixed(1) : null;
  const proteinTopShare =
    proteinTopShareCount > 0 ? Math.round((proteinTopShareSum / proteinTopShareCount) * 100) : null;
  const weekdayCalPct = weekdayDays >= 3 ? Math.round((weekdayActualCal / weekdayTargetCal) * 100) : null;
  const weekendCalPct = weekendDays >= 2 ? Math.round((weekendActualCal / weekendTargetCal) * 100) : null;
  const fatCalShare = sumActualCal > 0 ? Math.round(((sumActualFat * 9) / sumActualCal) * 100) : null;
  const targetFatShare = state.profile ? Number(state.profile.fatRatio || 25) : null;

  // たんぱく源が何種類あるか(2回以上登場したものだけ数える)
  const proteinSourceCats = PROTEIN_SOURCE_CATEGORIES.filter((c) => (foodCatDays[c] || 0) >= 2);
  // 同じメニューばかりになっていないか(メニュー名の種類 ÷ 記録した食事の件数)
  const menuVariety = mealEntryCount > 0 ? Math.round((mealNameSet.size / mealEntryCount) * 100) : null;

  // 最後にトレーニングしてから何日経ったか(期間ではなく全記録から見る)
  const allWorkoutDates = state.workouts.map((w) => w.date).sort();
  const lastWorkoutDate = allWorkoutDates.length ? allWorkoutDates[allWorkoutDates.length - 1] : null;
  const daysSinceLastWorkout = lastWorkoutDate
    ? Math.round((new Date(todayStr() + "T00:00:00") - new Date(lastWorkoutDate + "T00:00:00")) / 86400000)
    : null;

  // Weight pace: kg/week between the first and last weigh-in inside the period.
  const periodWeights = state.weightLogs
    .filter((l) => l.date >= dates[0] && l.date <= dates[dates.length - 1])
    .sort((a, b) => a.date.localeCompare(b.date));
  let weeklyRate = null;
  if (periodWeights.length >= 2) {
    const first = periodWeights[0];
    const last = periodWeights[periodWeights.length - 1];
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    if (days > 0) weeklyRate = +(((last.weight - first.weight) / days) * 7).toFixed(2);
  }

  return {
    totalDays: dates.length,
    loggedMealDays,
    workoutDays,
    avgCaloriePct,
    avgProteinPct,
    avgFatPct,
    avgCarbPct,
    avgCalDiff,
    avgProteinDiff,
    weeklyRate,
    weeklyBuckets,
    mealTypeSummary,
    avgCalWorkoutDay,
    avgCalRestDay,
    workoutDayCalCount,
    restDayCalCount,
    avgMealsPerDay,
    avgLastMealHour,
    proteinTopShare,
    snackCalShare,
    weekdayCalPct,
    weekendCalPct,
    fatCalShare,
    targetFatShare,
    foodCatDays,
    proteinSourceCats,
    menuVariety,
    distinctMenus: mealNameSet.size,
    muscleGroupCounts,
    longestNoTrainGap,
    daysSinceLastWorkout,
    weightLogDays: periodWeights.length,
    hasAnyData: loggedMealDays > 0 || workoutDays > 0 || periodWeights.length > 0,
  };
}

function generateInsights(m) {
  const insights = [];

  if (m.totalDays > 0 && m.loggedMealDays / m.totalDays < 0.5) {
    insights.push({
      tone: "info",
      text: `食事の記録日数が${m.loggedMealDays}/${m.totalDays}日と少なめです。記録が増えるほど、この傾向分析の精度も上がります。`,
    });
  }

  if (m.avgCaloriePct !== null) {
    if (m.avgCaloriePct < 90) {
      insights.push({
        tone: "warning",
        text: `平均カロリー摂取が目標の${m.avgCaloriePct}%です。体重を増やすには、あと1日${m.avgCalDiff}kcalほど意識して増やすとペースが安定しそうです。`,
      });
    } else if (m.avgCaloriePct <= 115) {
      insights.push({ tone: "good", text: `カロリー摂取は目標にほぼ沿えています(平均${m.avgCaloriePct}%)。このペースを継続しましょう。` });
    } else {
      insights.push({
        tone: "warning",
        text: `平均カロリーが目標を大きく超えています(平均${m.avgCaloriePct}%)。増量ペースが早すぎると体脂肪の増加が大きくなりやすいので、少し抑えるのも一案です。`,
      });
    }
  }

  if (m.avgProteinPct !== null) {
    if (m.avgProteinPct < 90) {
      insights.push({
        tone: "warning",
        text: `たんぱく質摂取が目標(体重×2g)の${m.avgProteinPct}%にとどまっています。あと1日${m.avgProteinDiff}gほど、プロテインや高たんぱく食品を追加してみましょう。`,
      });
    } else {
      insights.push({ tone: "good", text: `たんぱく質は目標をしっかり満たせています(平均${m.avgProteinPct}%)。` });
    }
  }

  if (m.weeklyRate !== null) {
    if (m.weeklyRate < 0.1) {
      insights.push({
        tone: "warning",
        text: `体重の増加ペースが週${m.weeklyRate >= 0 ? "+" : ""}${m.weeklyRate}kgとゆっくりです。増量を優先するなら、設定タブの「カロリー上乗せ」を少し増やすと良いかもしれません。`,
      });
    } else if (m.weeklyRate <= 0.5) {
      insights.push({ tone: "good", text: `体重は週+${m.weeklyRate}kgペースで増えています。筋肉中心で増量する良いペースです。` });
    } else {
      insights.push({
        tone: "warning",
        text: `体重が週+${m.weeklyRate}kgペースで急に増えています。体脂肪の増加が大きくなっている可能性があるので、カロリーの上乗せをやや抑えるのも一案です。`,
      });
    }
  } else if (m.totalDays > 7) {
    insights.push({ tone: "info", text: "この期間の体重記録が2件未満のため、増減ペースを計算できません。体重タブで定期的に記録してみましょう。" });
  }

  const expectedWorkoutDays = Math.round((m.totalDays / 7) * 2); // ~2x/week baseline
  if (m.totalDays >= 7) {
    if (m.workoutDays < expectedWorkoutDays) {
      insights.push({
        tone: "warning",
        text: `この期間のトレーニング日数は${m.workoutDays}日でした。筋肉量を増やすには週2〜3回を目安に継続すると効果が出やすいです。`,
      });
    } else {
      insights.push({ tone: "good", text: `トレーニングは${m.workoutDays}日実施できています。良いペースです。` });
    }
  }

  if (insights.length === 0) {
    insights.push({ tone: "info", text: "記録が増えると、ここに気づきが表示されます。" });
  }

  return insights;
}

// 栄養素ごとに「不足時に薦めやすい食品」。既存の食材選択肢(index.html)の
// value属性と同じ表記にしてあり、そのまま「食事」タブで選べる。
const MACRO_ADVICE_CONFIG = [
  { key: "carb", label: "炭水化物", pctField: "avgCarbPct", avgField: "avgCarb", foods: ["白米(ごはん)", "食パン", "バナナ", "オートミール(乾)"] },
  { key: "protein", label: "たんぱく質", pctField: "avgProteinPct", avgField: "avgProtein", foods: ["鶏ささみ", "プロテイン(NORM)", "卵", "納豆"] },
  { key: "fat", label: "脂質", pctField: "avgFatPct", avgField: "avgFat", foods: ["ミックスナッツ", "チーズ", "サーモン"] },
];

// 区分ごとに「その時間帯に足しやすい食品」。同じ栄養素を補う場合でも、
// 間食に白米を勧めるような不自然な提案にならないよう、区分に合うものを優先する。
const MEAL_TYPE_FOOD_HINTS = {
  "朝食": ["食パン", "バナナ", "オートミール(乾)", "卵", "納豆", "ギリシャヨーグルト(無糖)", "チーズ"],
  "昼食": ["白米(ごはん)", "鶏むね肉(皮なし)", "鶏ささみ", "ツナ缶(水煮)", "サーモン", "豚ロース(赤肉)"],
  "夕食": ["白米(ごはん)", "鶏もも肉(皮なし)", "サーモン", "豚ロース(赤肉)", "牛もも肉(赤肉)", "豆腐(木綿)"],
  "間食": ["バナナ", "プロテイン(NORM)", "ミックスナッツ", "ギリシャヨーグルト(無糖)", "チーズ"],
};

// その栄養素を補える食品のうち、区分に合うものがあればそれだけを提案する
function foodsForMealType(foods, mealType) {
  const hints = MEAL_TYPE_FOOD_HINTS[mealType];
  if (hints) {
    const matched = hints.filter((f) => foods.includes(f));
    if (matched.length > 0) return matched.slice(0, 2);
  }
  return foods.slice(0, 2);
}

const ADVICE_MAX_ITEMS = 7; // 出しすぎても読まないので、上位いくつかに絞る
const ADVICE_MAX_PER_CATEGORY = 2; // 同じ切り口ばかりにならないよう、分野ごとに上限を設ける

// 「気づき」が目標との単純な過不足(達成率)を見るのに対して、こちらは
// 食事の時間帯・区分・回数、トレーニングの部位や重量の伸び、平日と週末の差、
// 体重の動きなど複数の角度から記録を突き合わせ、具体的な対策まで踏み込む。
// 各分析は candidate(候補)を積むだけで、最後に優先度と分野バランスで絞り込む。
function generateExpertAdvice(m) {
  const cands = [];
  const push = (cat, priority, tone, text) => cands.push({ cat, priority, tone, text });
  const types = Object.entries(m.mealTypeSummary).filter(([, t]) => t.count >= 2);
  const hasEnoughMealData = m.loggedMealDays >= 3;

  // ---------- 栄養バランス ----------
  // 不足している栄養素のうち、特に足りない2つだけを「いつ・何を」まで具体化する
  if (hasEnoughMealData && types.length >= 2) {
    MACRO_ADVICE_CONFIG.map((c) => ({ c, pct: m[c.pctField] }))
      .filter((x) => x.pct !== null && x.pct < 90)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 2)
      .forEach(({ c, pct }) => {
        const [type, stat] = types.reduce((min, cur) => (cur[1][c.avgField] < min[1][c.avgField] ? cur : min));
        const timePhrase = stat.avgHour !== null ? `(いつも${stat.avgHour}時台ごろ)` : "";
        push(
          "nutrition",
          1,
          "warning",
          `${c.label}が目標の平均${pct}%と不足気味です。中でも${type}${timePhrase}の${c.label}が他の食事より少ないので、${type}に${foodsForMealType(c.foods, type).join("・")}を1品足すのが一番の近道です。`
        );
      });
  }

  // 脂質の摂りすぎは、同じカロリーでも体脂肪に回りやすい
  if (m.avgFatPct !== null && m.avgFatPct > 130 && hasEnoughMealData) {
    push(
      "nutrition",
      2,
      "warning",
      `脂質が目標の平均${m.avgFatPct}%と多めです。同じカロリーなら、脂質より炭水化物から摂った方がトレーニングの力が出やすくなります。揚げ物や脂身の多い肉を、白米やオートミールに置き換えてみてください。`
    );
  }

  // カロリーの内訳(P/F/C)そのものが目標配分からずれていないか
  if (m.fatCalShare !== null && m.targetFatShare !== null && hasEnoughMealData) {
    const gap = m.fatCalShare - m.targetFatShare;
    if (gap >= 10) {
      push(
        "nutrition",
        3,
        "info",
        `摂ったカロリーのうち脂質が${m.fatCalShare}%を占めています(目標は${m.targetFatShare}%)。脂質は少量でカロリーが高いので、ここを削ると食べる量を減らさずにバランスを整えられます。`
      );
    } else if (gap <= -10) {
      push(
        "nutrition",
        3,
        "info",
        `摂ったカロリーのうち脂質は${m.fatCalShare}%と、目標の${m.targetFatShare}%より控えめです。脂質が少なすぎるとホルモンの働きが落ちるので、ミックスナッツやサーモンで少し足すと良いバランスになります。`
      );
    }
  }

  // ---------- 食べ方・タイミング ----------
  // 朝食を抜きがちだと、1日の総量が足りなくなりやすい
  const breakfast = m.mealTypeSummary["朝食"];
  const breakfastDays = breakfast ? breakfast.days : 0;
  if (m.loggedMealDays >= 5 && breakfastDays / m.loggedMealDays < 0.6) {
    push(
      "timing",
      2,
      "warning",
      `食事を記録した${m.loggedMealDays}日のうち、朝食があったのは${breakfastDays}日だけです。朝を抜くと1日の合計が足りなくなりやすいので、卵・バナナ・食パンなど、用意が簡単なものだけでも入れてみてください。`
    );
  }

  // たんぱく質は一度に使える量が限られるので、1食への偏りを見る
  if (m.proteinTopShare !== null && m.proteinTopShare >= 50 && m.loggedMealDays >= 5) {
    push(
      "timing",
      2,
      "warning",
      `1日のたんぱく質のうち平均${m.proteinTopShare}%を1食でまとめて摂っています。体が一度に使える量には限りがあるので、同じ量でも3食に分ける方が筋肉になりやすいです。`
    );
  }

  // 食事回数が少ないと、増量に必要な量を詰め込みにくい
  if (m.avgMealsPerDay !== null && m.avgMealsPerDay < 2.5 && m.loggedMealDays >= 5) {
    push(
      "timing",
      3,
      "info",
      `1日の食事回数が平均${m.avgMealsPerDay}回です。増量中は1回の量を増やすより回数を増やす方が楽なので、間食にプロテインやミックスナッツを足すのがおすすめです。`
    );
  }

  // 最後の食事が遅いと、睡眠の質と翌朝の食欲に影響する
  if (m.avgLastMealHour !== null && m.avgLastMealHour >= 21 && m.loggedMealDays >= 5) {
    const h = Math.floor(m.avgLastMealHour);
    push(
      "timing",
      3,
      "info",
      `1日の最後の食事が平均${h}時台と遅めです。寝る2〜3時間前までに済ませると睡眠が深くなり、翌朝きちんとお腹が空くので朝食も入りやすくなります。`
    );
  }

  // 間食に寄りすぎていないか
  if (m.snackCalShare !== null && m.snackCalShare >= 30 && m.loggedMealDays >= 5) {
    push(
      "timing",
      4,
      "info",
      `摂取カロリーの${m.snackCalShare}%が間食からです。間食は補助として便利ですが、食事の方でしっかり摂れると栄養バランスが安定します。`
    );
  }

  // ---------- 栄養面(何を食べているか) ----------
  // カロリーとPFCが合っていても、食材が偏るとビタミン・ミネラル・食物繊維が
  // 不足しやすい。メニュー名から食品の登場頻度を見て、中身の偏りを指摘する。
  const catDay = (c) => m.foodCatDays[c] || 0;
  if (m.loggedMealDays >= 5) {
    const vegRate = catDay("野菜") / m.loggedMealDays;
    if (vegRate < 0.4) {
      push(
        "food",
        2,
        "warning",
        `食事を記録した${m.loggedMealDays}日のうち、野菜が出てきたのは${catDay("野菜")}日だけです。ビタミン・ミネラル・食物繊維が不足すると、食べた栄養を筋肉に変える効率そのものが落ちます。味噌汁やサラダ、ブロッコリーを1品足すだけでも変わります。`
      );
    }

    // 魚は週1回も無いなら、脂の質(オメガ3)の観点で提案する
    if (catDay("魚") <= Math.floor(m.loggedMealDays / 7)) {
      push(
        "food",
        3,
        "info",
        `記録の中に魚がほとんど出てきていません(${catDay("魚")}日)。魚の脂(オメガ3)は関節の炎症を抑えて回復を助けるので、週1〜2回はサーモンやツナ缶に置き換えると、同じたんぱく質量でも体の回復が変わります。`
      );
    }

    if (catDay("果物") / m.loggedMealDays < 0.2) {
      push(
        "food",
        4,
        "info",
        `果物の登場が${catDay("果物")}日と少なめです。ビタミンCやカリウムは汗と一緒に失われやすく、不足すると疲れが抜けにくくなります。トレーニング前後のバナナは、糖質補給も兼ねられて手軽です。`
      );
    }

    // たんぱく源の種類が少ないと、アミノ酸や微量栄養素が偏る
    if (m.proteinSourceCats.length > 0 && m.proteinSourceCats.length <= 2) {
      push(
        "food",
        3,
        "warning",
        `たんぱく質の摂取元が${m.proteinSourceCats.join("・")}に偏っています。肉・魚・卵・大豆・乳製品では含まれる微量栄養素が違うので、種類を散らすと同じたんぱく質量でも体づくりが有利になります。`
      );
    }

    // 粉のプロテインに頼りすぎていないか
    const proteinPowderRate = catDay("プロテイン") / m.loggedMealDays;
    if (proteinPowderRate >= 0.7 && catDay("魚") + catDay("卵") + catDay("大豆") < m.loggedMealDays * 0.5) {
      push(
        "food",
        4,
        "info",
        `たんぱく質をプロテイン(粉)に頼る割合が高くなっています。手軽さは大きな武器ですが、食事から摂ると鉄・亜鉛・ビタミンB群も一緒に入ってきます。1回分を卵や納豆に置き換えるところから試してみてください。`
      );
    }

    // 同じメニューの繰り返しは、足りない栄養素も固定されてしまう
    if (m.menuVariety !== null && m.menuVariety < 30 && m.loggedMealDays >= 7) {
      push(
        "food",
        4,
        "info",
        `記録された食事${m.loggedMealDays}日分のうち、メニューの種類は${m.distinctMenus}通りでした。同じものが続くと、足りない栄養素もずっと同じものが足りないままになります。主食を白米からオートミールに変える日を作るだけでも、食物繊維とミネラルが補えます。`
      );
    }

    // 中身が整っている場合はきちんと認める
    if (vegRate >= 0.6 && catDay("魚") >= 2 && m.proteinSourceCats.length >= 3) {
      push(
        "food",
        5,
        "good",
        `野菜が${catDay("野菜")}日、魚が${catDay("魚")}日登場し、たんぱく源も${m.proteinSourceCats.length}種類に散らせています。数字に出ないビタミン・ミネラル面まで整っている、質の高い食事内容です。`
      );
    }
  }

  // ---------- 生活リズム ----------
  // 平日と週末で食事が変わっていないか
  if (m.weekdayCalPct !== null && m.weekendCalPct !== null) {
    const gap = m.weekdayCalPct - m.weekendCalPct;
    if (gap >= 15) {
      push(
        "rhythm",
        3,
        "warning",
        `週末のカロリーが平日より落ちています(平日${m.weekdayCalPct}% / 週末${m.weekendCalPct}%)。予定が読めない日ほど、朝のうちにプロテインやおにぎりを用意しておくと崩れにくくなります。`
      );
    } else if (gap <= -15) {
      push(
        "rhythm",
        3,
        "warning",
        `平日のカロリーが週末より落ちています(平日${m.weekdayCalPct}% / 週末${m.weekendCalPct}%)。仕事の日は食事が後回しになりがちなので、机に置ける間食を常備しておくと安定します。`
      );
    }
  }

  // トレーニングした日にきちんと食べられているか
  if (m.workoutDayCalCount >= 2 && m.restDayCalCount >= 2) {
    const diff = m.avgCalRestDay - m.avgCalWorkoutDay;
    if (diff > 100) {
      push(
        "rhythm",
        2,
        "warning",
        `トレーニングした日の摂取カロリーが、していない日より平均${diff}kcal少ない傾向があります(${m.avgCalWorkoutDay}kcal vs ${m.avgCalRestDay}kcal)。動いた日ほど多く必要なので、トレーニング後の食事を一番しっかりにするのが理想です。`
      );
    } else if (diff < -100) {
      push(
        "rhythm",
        5,
        "good",
        `トレーニングした日の方が平均${Math.abs(diff)}kcal多く食べられています(${m.avgCalWorkoutDay}kcal vs ${m.avgCalRestDay}kcal)。動いた日にしっかり補給できている、理想的なリズムです。`
      );
    }
  }

  // ---------- トレーニング ----------
  const groupEntries = Object.entries(m.muscleGroupCounts);
  const totalGroupSessions = groupEntries.reduce((s, [, n]) => s + n, 0);
  if (totalGroupSessions >= 6) {
    // やっていない部位(特に脚は後回しにされやすい)
    const missing = allMuscleGroups().filter((g) => !m.muscleGroupCounts[g]);
    if (missing.length > 0) {
      const target = missing.includes("脚") ? "脚" : missing[0];
      const extra =
        target === "脚"
          ? "脚は体で一番大きい筋肉なので、鍛えると全身のホルモン反応が高まり、上半身の伸びも良くなります。"
          : "全身をひと通り回すと、見た目のバランスと関節への負担の両面で有利になります。";
      push(
        "training",
        2,
        "warning",
        `この期間、${target}の種目が1回も記録されていません。${extra}週1回でも入れてみてください。`
      );
    }

    // 特定の部位に偏っていないか
    const [topGroup, topCount] = groupEntries.reduce((mx, cur) => (cur[1] > mx[1] ? cur : mx));
    const topShare = Math.round((topCount / totalGroupSessions) * 100);
    if (topShare >= 50 && missing.length === 0) {
      push(
        "training",
        3,
        "info",
        `トレーニングの${topShare}%が${topGroup}に集中しています。同じ部位ばかりだと回復が追いつかず、伸びが止まりやすくなります。日ごとに部位を分けると全体が伸びます。`
      );
    }
  }

  // トレーニングの間隔が空きすぎていないか
  if (m.daysSinceLastWorkout !== null && m.daysSinceLastWorkout >= 4) {
    push(
      "training",
      2,
      "warning",
      `最後のトレーニングから${m.daysSinceLastWorkout}日空いています。筋肉は3日ほどで回復するので、間隔が空くほど元に戻りやすくなります。まずは短時間でも再開するのが効果的です。`
    );
  } else if (m.longestNoTrainGap >= 6 && m.totalDays >= 14) {
    push(
      "training",
      3,
      "info",
      `この期間、最長で${m.longestNoTrainGap}日トレーニングが空いた時期がありました。1回あたりを短くしてでも、間隔を空けない方が結果につながります。`
    );
  }

  // ---------- 体重の動き ----------
  if (m.weeklyRate !== null && m.avgCaloriePct !== null) {
    if (Math.abs(m.weeklyRate) < 0.1 && m.avgCaloriePct >= 95) {
      push(
        "body",
        2,
        "warning",
        `目標カロリーは達成できている(平均${m.avgCaloriePct}%)のに、体重は週${m.weeklyRate}kgでほぼ動いていません。実際の消費が想定より多いということなので、設定タブの「カロリー上乗せ」を+200kcalほど増やすのが次の一手です。`
      );
    }
    if (m.weeklyRate > 0.5 && m.avgProteinPct !== null && m.avgProteinPct < 90) {
      push(
        "body",
        2,
        "warning",
        `体重は週+${m.weeklyRate}kgと順調に増えていますが、たんぱく質が目標の${m.avgProteinPct}%です。この状態で増えている分は脂肪の割合が多くなりがちなので、増やすならまずたんぱく質からです。`
      );
    }
  }

  // 体重の記録が少ないと、そもそもペースが読めない
  if (m.totalDays >= 14 && m.weightLogDays < Math.floor(m.totalDays / 7)) {
    push(
      "body",
      4,
      "info",
      `この期間の体重記録は${m.weightLogDays}回です。増量は「週あたり何kg」で判断するので、曜日を決めて週1回、朝起きた直後に測るとペースが正確に見えます。`
    );
  }

  // ---------- できている点 ----------
  const macroPcts = [m.avgCaloriePct, m.avgProteinPct, m.avgFatPct, m.avgCarbPct];
  if (macroPcts.every((p) => p !== null && p >= 90 && p <= 115)) {
    push(
      "praise",
      5,
      "good",
      `カロリー・たんぱく質・脂質・炭水化物のすべてが目標の90〜115%に収まっています。ここまで整っていれば、あとは同じ生活を続けるだけで体は変わっていきます。`
    );
  }
  if (m.totalDays >= 7 && m.loggedMealDays / m.totalDays >= 0.9) {
    push(
      "praise",
      5,
      "good",
      `${m.totalDays}日中${m.loggedMealDays}日、食事を記録できています。記録が続いていること自体が、この分析の精度と結果を支えています。`
    );
  }

  // 優先度順に並べ、同じ分野が続かないよう上限をかけて絞り込む
  const perCat = {};
  const picked = [];
  cands
    .sort((a, b) => a.priority - b.priority)
    .forEach((c) => {
      if (picked.length >= ADVICE_MAX_ITEMS) return;
      perCat[c.cat] = perCat[c.cat] || 0;
      if (perCat[c.cat] >= ADVICE_MAX_PER_CATEGORY) return;
      perCat[c.cat]++;
      picked.push(c);
    });

  if (picked.length === 0) {
    picked.push({
      tone: "info",
      text: "今のところ、時間帯・食事の種類・トレーニング内容にはっきりした偏りは見つかりませんでした。記録が増えると、より具体的な提案ができるようになります。",
    });
  }

  return picked;
}

function renderTrends() {
  const metrics = computeTrendMetrics(trendRange);
  const emptyEl = document.getElementById("trendsEmpty");
  const contentEl = document.getElementById("trendsContent");

  if (!metrics.hasAnyData) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const statsEl = document.getElementById("trendStats");
  const pct = (v) => (v === null ? "記録不足" : `${v}%`);
  statsEl.innerHTML = `
    <div class="ts-item"><div class="k">平均カロリー達成率</div><div class="v">${pct(metrics.avgCaloriePct)}</div></div>
    <div class="ts-item"><div class="k">平均たんぱく質達成率</div><div class="v">${pct(metrics.avgProteinPct)}</div></div>
    <div class="ts-item"><div class="k">平均脂質達成率</div><div class="v">${pct(metrics.avgFatPct)}</div></div>
    <div class="ts-item"><div class="k">平均炭水化物達成率</div><div class="v">${pct(metrics.avgCarbPct)}</div></div>
    <div class="ts-item"><div class="k">体重ペース(週あたり)</div><div class="v">${metrics.weeklyRate === null ? "記録不足" : `${metrics.weeklyRate >= 0 ? "+" : ""}${metrics.weeklyRate}kg`}</div></div>
    <div class="ts-item"><div class="k">食事記録日数</div><div class="v">${metrics.loggedMealDays}/${metrics.totalDays}日</div></div>
    <div class="ts-item"><div class="k">トレーニング日数</div><div class="v">${metrics.workoutDays}/${metrics.totalDays}日</div></div>
  `;

  renderTrendChart("trendChart", metrics.weeklyBuckets);

  const icons = { good: "✅", warning: "⚠️", info: "💡" };

  const insightsEl = document.getElementById("trendInsights");
  insightsEl.innerHTML = generateInsights(metrics)
    .map((i) => `<div class="insight-item ${i.tone}"><span class="icon">${icons[i.tone]}</span><span>${escapeHTML(i.text)}</span></div>`)
    .join("");

  const adviceEl = document.getElementById("expertAdvice");
  adviceEl.innerHTML = generateExpertAdvice(metrics)
    .map((i) => `<div class="insight-item ${i.tone}"><span class="icon">${icons[i.tone]}</span><span>${escapeHTML(i.text)}</span></div>`)
    .join("");
}

function renderTrendChart(canvasId, buckets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const cssHeight = Number(canvas.getAttribute("height")) || 160;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#1f7a5c";
  const orange = styles.getPropertyValue("--accent-orange").trim() || "#e0793a";
  const muted = styles.getPropertyValue("--text-muted").trim() || "#888";
  const border = styles.getPropertyValue("--border").trim() || "#ddd";

  if (buckets.length === 0) {
    ctx.fillStyle = muted;
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillText("食事の記録が足りないため、週別グラフを表示できません。", 8, cssHeight / 2);
    return;
  }

  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  const maxVal = Math.max(120, ...buckets.map((b) => b.pct));
  const y = (v) => padT + plotH - (v / maxVal) * plotH;

  // gridlines
  ctx.strokeStyle = border;
  ctx.fillStyle = muted;
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.lineWidth = 1;
  [0, 50, 100].forEach((v) => {
    if (v > maxVal) return;
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(cssWidth - padR, yy);
    ctx.stroke();
    ctx.fillText(String(v), 2, yy + 3);
  });

  // 100% target dashed line
  ctx.save();
  ctx.strokeStyle = orange;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, y(100));
  ctx.lineTo(cssWidth - padR, y(100));
  ctx.stroke();
  ctx.restore();

  // bars
  const slot = plotW / buckets.length;
  const barW = Math.min(28, slot * 0.55);
  ctx.fillStyle = primary;
  buckets.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const barY = y(b.pct);
    ctx.fillRect(cx - barW / 2, barY, barW, padT + plotH - barY);
  });

  // x labels (first/last only to avoid crowding)
  ctx.fillStyle = muted;
  ctx.font = "10px 'Share Tech Mono', monospace";
  const firstLabel = buckets[0].label;
  ctx.fillText(firstLabel, padL, cssHeight - 6);
  if (buckets.length > 1) {
    const lastLabel = buckets[buckets.length - 1].label;
    ctx.fillText(lastLabel, cssWidth - padR - ctx.measureText(lastLabel).width, cssHeight - 6);
  }
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
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderWeight();
  renderTrends();
  renderSettings();
}

function init() {
  initTabs();
  initDashboard();
  initMeals();
  initWorkouts();
  initWeight();
  initTrends();
  initSettings();
  renderAll();
  window.addEventListener("resize", () => {
    renderWeightChart("weightChart", state.weightLogs, 30);
    const days = weightChartRange === "all" ? null : Number(weightChartRange);
    renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
    const dailyTotals = mealDailyTotals();
    renderCalorieChart("calorieChart", dailyTotals, 30, currentTargetCalories());
    const calorieDays = calorieChartRange === "all" ? null : Number(calorieChartRange);
    renderCalorieChart("calorieChartFull", dailyTotals, calorieDays, currentTargetCalories());
    renderTrendChart("trendChart", computeTrendMetrics(trendRange).weeklyBuckets);
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
