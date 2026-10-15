
const STORAGE_KEY = "yoshi-health-tracker-v1";
const MEAL_LINK_HASH_PREFIX = "#meal=";


const DEFAULT_STATE = {
  profile: null,
  weightLogs: [],
  meals: [],
  workouts: [],
  importedMealIds: [],
  symptomLogs: [],
};

const SYMPTOMS = [
  { key: "fatigue", label: "疲労" },
  { key: "nausea", label: "吐き気" },
];

const FATIGUE_SLOTS = [
  { key: "morning", label: "朝", range: "6–10" },
  { key: "noon", label: "昼", range: "10–15" },
  { key: "evening", label: "夕", range: "15–19" },
  { key: "night", label: "夜", range: "19–24" },
];

let state = loadState();
let weightChartRange = "all";
let calorieChartRange = "all";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const next = { ...structuredClone(DEFAULT_STATE), ...parsed };
    next.symptomLogs = sanitizeSymptomLogs(next.symptomLogs);
    return next;
  } catch (e) {
    console.error("state load failed", e);
    return structuredClone(DEFAULT_STATE);
  }
}

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
    return true;
  } catch (e) {
    console.error("state save failed", e);
    return false;
  }
}

function dropOldestPhotosUntilItFits() {
  const withPhoto = state.meals
    .filter((m) => m.photo)
    .sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));

  const backup = withPhoto.map((m) => m.photo);

  let dropped = 0;
  for (const meal of withPhoto) {
    meal.photo = null;
    dropped++;
    if (writeState()) return dropped;
  }

  withPhoto.forEach((m, i) => (m.photo = backup[i]));
  return 0;
}

function setSaveErrorBanner(show) {
  const el = document.getElementById("saveErrorBanner");
  if (el) el.classList.toggle("hidden", !show);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

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

// URL fragments are not sent to GitHub Pages, so the meal stays between the chat
// and this browser.
function importMealFromLink() {
  if (!location.hash.startsWith(MEAL_LINK_HASH_PREFIX)) return false;

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

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function weekdayChar(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
}

function symptomScore(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[1-5]$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return null;
  return value;
}

function sanitizeFatigueSlots(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const slots = {};
  let any = false;
  for (const slot of FATIGUE_SLOTS) {
    const score = symptomScore(raw[slot.key]);
    if (score == null) continue;
    slots[slot.key] = score;
    any = true;
  }
  return any ? slots : null;
}

function sanitizeSymptomLogs(logs) {
  if (!Array.isArray(logs)) return [];
  const byDate = new Map();
  for (const raw of logs) {
    if (!raw || typeof raw !== "object") continue;
    const date = String(raw.date || "");
    if (!isIsoDate(date)) continue;
    const entry = {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      date,
      fatigue: symptomScore(raw.fatigue),
      nausea: symptomScore(raw.nausea),
    };
    const slots = sanitizeFatigueSlots(raw.fatigueSlots);
    if (slots) entry.fatigueSlots = slots;
    const entries = sanitizeFatigueEntries(raw.fatigueEntries);
    if (entries) entry.fatigueEntries = entries;
    if (entry.fatigue == null && entry.nausea == null && !slots && !entries) continue;
    byDate.set(date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isHmTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sanitizeFatigueEntries(raw) {
  if (!Array.isArray(raw)) return null;
  const entries = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const score = symptomScore(item.score);
    const time = String(item.time || "");
    if (score == null || !isHmTime(time)) continue;
    entries.push({
      id: typeof item.id === "string" && item.id ? item.id : uid(),
      time,
      score,
    });
  }
  if (!entries.length) return null;
  entries.sort((a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id)));
  return entries;
}

function symptomLogIsEmpty(log) {
  if (!log) return true;
  if (log.fatigue != null || log.nausea != null) return false;
  if (log.fatigueSlots && FATIGUE_SLOTS.some((slot) => log.fatigueSlots[slot.key] != null)) return false;
  return !log.fatigueEntries || log.fatigueEntries.length === 0;
}

function fatigueSlotScore(log, key) {
  if (!log || !log.fatigueSlots) return null;
  return symptomScore(log.fatigueSlots[key]);
}

function getSymptomLog(date) {
  return (state.symptomLogs || []).find((log) => log.date === date) || null;
}

function setSymptom(date, key, score) {
  if (!isIsoDate(date) || !SYMPTOMS.some((symptom) => symptom.key === key)) return;
  const value = score == null ? null : symptomScore(score);
  if (score != null && value == null) return;

  if (!Array.isArray(state.symptomLogs)) state.symptomLogs = [];
  let log = state.symptomLogs.find((item) => item.date === date);
  if (!log) {
    if (value == null) return;
    log = { id: uid(), date, fatigue: null, nausea: null };
    state.symptomLogs.push(log);
  }
  log[key] = value;
  if (symptomLogIsEmpty(log)) {
    state.symptomLogs = state.symptomLogs.filter((item) => item.date !== date);
  }
  saveState();
  renderSymptoms(date);
}

function setFatigueSlot(date, slot, score) {
  if (!isIsoDate(date) || !FATIGUE_SLOTS.some((item) => item.key === slot)) return;
  const value = score == null ? null : symptomScore(score);
  if (score != null && value == null) return;

  if (!Array.isArray(state.symptomLogs)) state.symptomLogs = [];
  let log = state.symptomLogs.find((item) => item.date === date);
  if (!log) {
    if (value == null) return;
    log = { id: uid(), date, fatigue: null, nausea: null };
    state.symptomLogs.push(log);
  }
  if (!log.fatigueSlots || typeof log.fatigueSlots !== "object" || Array.isArray(log.fatigueSlots)) {
    log.fatigueSlots = {};
  }
  if (value == null) delete log.fatigueSlots[slot];
  else log.fatigueSlots[slot] = value;
  if (Object.keys(log.fatigueSlots).length === 0) delete log.fatigueSlots;
  if (symptomLogIsEmpty(log)) {
    state.symptomLogs = state.symptomLogs.filter((item) => item.date !== date);
  }
  saveState();
  renderSymptoms(date);
}

function sortedFatigueEntries(log) {
  if (!log || !Array.isArray(log.fatigueEntries)) return [];
  return [...log.fatigueEntries].sort((a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id)));
}

function addFatigueEntry(date, score, time) {
  if (!isIsoDate(date) || !isHmTime(time)) return;
  const value = symptomScore(score);
  if (value == null) return;
  if (!Array.isArray(state.symptomLogs)) state.symptomLogs = [];
  let log = state.symptomLogs.find((item) => item.date === date);
  if (!log) {
    log = { id: uid(), date, fatigue: null, nausea: null };
    state.symptomLogs.push(log);
  }
  if (!Array.isArray(log.fatigueEntries)) log.fatigueEntries = [];
  log.fatigueEntries.push({ id: uid(), time, score: value });
  saveState();
  renderSymptoms(date);
}

function updateFatigueEntryTime(date, id, time) {
  if (!isIsoDate(date)) return;
  const log = getSymptomLog(date);
  const entry = log && Array.isArray(log.fatigueEntries) ? log.fatigueEntries.find((item) => item.id === id) : null;
  if (!entry) return;
  if (!isHmTime(time)) {
    renderSymptoms(date);
    return;
  }
  if (entry.time === time) return;
  entry.time = time;
  saveState();
  renderSymptoms(date);
}

function deleteFatigueEntry(date, id) {
  const log = getSymptomLog(date);
  if (!log || !Array.isArray(log.fatigueEntries)) return;
  const next = log.fatigueEntries.filter((item) => item.id !== id);
  if (next.length === log.fatigueEntries.length) return;
  if (next.length === 0) delete log.fatigueEntries;
  else log.fatigueEntries = next;
  if (symptomLogIsEmpty(log)) {
    state.symptomLogs = state.symptomLogs.filter((item) => item.date !== date);
  }
  saveState();
  renderSymptoms(date);
}

function fatigueRecordText(log, emptyLabel) {
  const parts = [];
  if (log && log.fatigue != null) parts.push(`時間なし${log.fatigue}`);
  for (const slot of FATIGUE_SLOTS) {
    const score = fatigueSlotScore(log, slot.key);
    if (score != null) parts.push(`${slot.label}${score}`);
  }
  for (const entry of sortedFatigueEntries(log)) parts.push(`${entry.time}は${entry.score}`);
  return parts.length ? parts.join(" ") : emptyLabel;
}

function minutesOfTime(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

const FATIGUE_CHART_X_INSET = 13;
const FATIGUE_CHART_Y_INSET = 12;

function fatigueChartX(minutes, nudge = 0) {
  const span = 100 - FATIGUE_CHART_X_INSET * 2;
  const x = FATIGUE_CHART_X_INSET + (minutes / 1440) * span + nudge;
  return Math.max(FATIGUE_CHART_X_INSET, Math.min(100 - FATIGUE_CHART_X_INSET, x));
}

function fatigueChartY(score) {
  const span = 100 - FATIGUE_CHART_Y_INSET * 2;
  return FATIGUE_CHART_Y_INSET + ((5 - score) / 4) * span;
}

function fatigueChartMarks(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.time}:${entry.score}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const marks = entries.map((entry) => {
    const group = groups.get(`${entry.time}:${entry.score}`);
    const index = group.findIndex((item) => item.id === entry.id);
    const nudge = (index - (group.length - 1) / 2) * 5;
    return {
      ...entry,
      x: fatigueChartX(minutesOfTime(entry.time), nudge),
      y: fatigueChartY(entry.score),
      place: "n",
    };
  });
  marks.sort((a, b) => a.x - b.x || a.y - b.y || String(a.id).localeCompare(String(b.id)));
  for (const mark of marks) {
    if (mark.y < 22) mark.place = "s";
  }
  if (marks.length === 1) {
    marks[0].place = marks[0].x > 70 ? "w" : "e";
    marks[0].showTime = true;
    return marks;
  }
  for (let i = 0; i < marks.length; i++) {
    for (let j = 0; j < i; j++) {
      const dx = Math.abs(marks[i].x - marks[j].x);
      const dy = Math.abs(marks[i].y - marks[j].y);
      if (dx > 16 || dy > 30) continue;
      marks[i].place = marks[i].x > 76 ? "w" : "e";
      if (marks[j].place === "n" || marks[j].place === "s") {
        marks[j].place = marks[j].x < 24 ? "e" : "w";
      }
    }
  }
  return marks;
}

function fatigueChartHTML(entries) {
  const sorted = [...entries].sort(
    (a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id))
  );
  const marks = fatigueChartMarks(sorted);
  const yLabels = [5, 4, 3, 2, 1]
    .map((score) => `<span style="top:${fatigueChartY(score)}%">${score}</span>`)
    .join("");
  const xLabels = [0, 6, 12, 18, 24]
    .map((hour) => {
      const label = hour === 0 || hour === 24 ? `${hour}時` : String(hour);
      return `<span style="left:${fatigueChartX(hour * 60)}%">${label}</span>`;
    })
    .join("");
  const dots = marks
    .map((mark) => {
      const time = mark.showTime ? `<small>${mark.time}</small>` : "";
      return `<span class="fatigue-mark place-${mark.place}" style="left:${mark.x}%;top:${mark.y}%"><span class="fatigue-mark-label"><b>${mark.score}</b>${time}</span></span>`;
    })
    .join("");
  const empty = sorted.length
    ? ""
    : `<p class="fatigue-chart-empty">この日の時刻の記録はまだありません。</p>`;
  const label = sorted.length
    ? `疲労の推移。${sorted.map((entry) => `${entry.time} は ${entry.score}`).join("、")}`
    : "この日の時刻の記録はまだありません";
  const points = marks.length >= 2 ? ` data-points="${marks.map((mark) => `${mark.x},${mark.y}`).join(" ")}"` : "";
  return `<div class="fatigue-chart${sorted.length === 0 ? " is-empty" : ""}" role="img" aria-label="${label}">
    <div class="fatigue-chart-y" aria-hidden="true">${yLabels}</div>
    <div class="fatigue-chart-plot">
      <canvas class="fatigue-chart-canvas"${points} aria-hidden="true"></canvas>
      ${dots}${empty}
    </div>
    <div class="fatigue-chart-x" aria-hidden="true">${xLabels}</div>
  </div>`;
}

let fatigueChartPaintEntries = [];
let fatigueChartObserver = null;

function paintFatigueChart(entries) {
  fatigueChartPaintEntries = entries;
  const draw = () => {
    const canvas = document.querySelector("#fatigueAxis .fatigue-chart-canvas");
    if (canvas) drawFatigueChart(canvas, fatigueChartPaintEntries);
  };
  draw();
  if (typeof pencilTexReady !== "undefined" && pencilTexReady && typeof pencilTexReady.then === "function") {
    pencilTexReady.then(draw);
  }
  if (typeof ResizeObserver !== "function") return;
  if (!fatigueChartObserver) {
    fatigueChartObserver = new ResizeObserver(() => {
      const canvas = document.querySelector("#fatigueAxis .fatigue-chart-canvas");
      if (canvas) drawFatigueChart(canvas, fatigueChartPaintEntries);
    });
  }
  fatigueChartObserver.disconnect();
  const plot = document.querySelector("#fatigueAxis .fatigue-chart-plot");
  if (plot) fatigueChartObserver.observe(plot);
}

function drawFatigueChart(canvas, entries) {
  const plot = canvas.parentElement;
  if (!plot) return;
  const cssWidth = plot.clientWidth;
  const cssHeight = plot.clientHeight;
  if (cssWidth < 2 || cssHeight < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const bitmapW = Math.round(cssWidth * dpr);
  const bitmapH = Math.round(cssHeight * dpr);
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW;
    canvas.height = bitmapH;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim() || "#cc6445";
  const graphite = styles.getPropertyValue("--graphite").trim() || "#3a3936";
  const surfaceAlt = styles.getPropertyValue("--surface-alt").trim() || "#efe9dc";
  const px = (pct) => (pct / 100) * cssWidth;
  const py = (pct) => (pct / 100) * cssHeight;
  const sorted = [...entries].sort(
    (a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id))
  );
  const marks = fatigueChartMarks(sorted);

  ctx.save();
  ctx.strokeStyle = graphite;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const score of [5, 4, 3, 2, 1]) {
    const y = py(fatigueChartY(score));
    ctx.beginPath();
    pencilLineTo(ctx, 0, y, cssWidth, y, score + 1);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.16;
  for (const hour of [6, 12, 18]) {
    const x = px(fatigueChartX(hour * 60));
    ctx.beginPath();
    pencilLineTo(ctx, x, py(fatigueChartY(5)), x, py(fatigueChartY(1)), hour + 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  pencilLineTo(ctx, 0.6, py(fatigueChartY(5)), 0.6, py(fatigueChartY(1)), 9);
  ctx.stroke();
  ctx.restore();

  if (marks.length >= 2) {
    ctx.beginPath();
    for (let i = 1; i < marks.length; i++) {
      pencilLineTo(
        ctx,
        px(marks[i - 1].x),
        py(marks[i - 1].y),
        px(marks[i].x),
        py(marks[i].y),
        i + 4
      );
    }
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2.1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.save();
    ctx.translate(0.8, -0.7);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  const jit = (i, k) => {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s) - 0.5;
  };
  marks.forEach((mark, i) => {
    const r = 4.4;
    const cx = px(mark.x);
    const cy = py(mark.y);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r + jit(i, 1) * 0.7, r + jit(i, 2) * 0.7, jit(i, 3), 0, Math.PI * 2);
    ctx.fillStyle = surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = primary;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 0.4, cy - 0.4, r + 0.5, -2.4 + jit(i, 4), 0.9 + jit(i, 5));
    ctx.save();
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.restore();
  });

  pencilGrain(ctx, 0, 0, cssWidth, cssHeight);
}

function fatigueEntryListHTML(entries) {
  if (!entries.length) return "";
  return entries
    .map(
      (entry) => `<div class="fatigue-entry">
        <input type="time" value="${entry.time}" data-entry-id="${entry.id}" aria-label="${entry.time} の時刻">
        <span class="fatigue-entry-score">${entry.score}</span>
        <button type="button" class="fatigue-entry-delete" data-fatigue-delete="${entry.id}" aria-label="削除">削除</button>
      </div>`
    )
    .join("");
}

function symptomLine(log, emptyLabel) {
  const nausea = !log || log.nausea == null ? emptyLabel : String(log.nausea);
  return `吐き気 ${nausea} ・ 疲労 ${fatigueRecordText(log, emptyLabel)}`;
}

function symptomSummaryText() {
  const logs = sanitizeSymptomLogs(state.symptomLogs);
  if (!logs.length) return "";
  const lines = ["疲労と吐き気（1が軽い、5が強い）"];
  for (const log of logs) lines.push(`${log.date} ${symptomLine(log, "未記録")}`);
  return lines.join("\n");
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  return logs[0];
}

function getLatestWeight() {
  const logs = sortedWeightLogs();
  return logs.length ? logs[logs.length - 1] : null;
}

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

function initDashboard() {
  const dateInput = document.getElementById("dashboardDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderDashboard);
  document.getElementById("copyDayForClaudeBtn").addEventListener("click", copyDayForClaude);
  document.getElementById("conditionCard").addEventListener("click", onSymptomScaleClick);
  document.getElementById("fatigueEntryList").addEventListener("change", onFatigueTimeChange);
  document.getElementById("symptomHistory").addEventListener("click", onSymptomHistoryClick);
  document.getElementById("copySymptomsBtn").addEventListener("click", copySymptomLog);
}

function onFatigueTimeChange(event) {
  const input = event.target.closest("input[type='time']");
  if (!input) return;
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  updateFatigueEntryTime(dateStr, input.dataset.entryId, input.value);
}

function onSymptomScaleClick(event) {
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  const remove = event.target.closest("[data-fatigue-delete]");
  if (remove) {
    deleteFatigueEntry(dateStr, remove.dataset.fatigueDelete);
    return;
  }
  const button = event.target.closest("[data-symptom]");
  if (!button) return;
  const key = button.dataset.symptom;
  const score = symptomScore(button.dataset.score);
  if (!score) return;
  if (key === "fatigue") {
    addFatigueEntry(dateStr, score, nowTimeStr());
    return;
  }
  if (key !== "nausea") return;
  const current = getSymptomLog(dateStr);
  setSymptom(dateStr, key, current && current[key] === score ? null : score);
}

function onSymptomHistoryClick(event) {
  const row = event.target.closest("[data-date]");
  if (!row || !isIsoDate(row.dataset.date)) return;
  const dateInput = document.getElementById("dashboardDate");
  dateInput.value = row.dataset.date;
  renderDashboard();
  document.getElementById("conditionCard").scrollIntoView({ block: "nearest" });
}

async function copySymptomLog() {
  const text = symptomSummaryText();
  if (!text) {
    toast("コピーする記録がありません");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch (error) {
    prompt("この記録をコピーしてください", text);
  }
}

function renderSymptoms(dateStr) {
  const hint = document.getElementById("symptomDateHint");
  const summary = document.getElementById("symptomHistorySummary");
  const history = document.getElementById("symptomHistory");
  if (!hint || !summary || !history) return;

  const day = isIsoDate(dateStr) ? dateStr : todayStr();
  hint.textContent = `${fmtDate(day)}(${weekdayChar(day)})の記録です。1が軽い、5が強い。`;

  const log = getSymptomLog(day);
  document.querySelectorAll("#conditionCard [data-symptom='nausea']").forEach((button) => {
    const selected = !!log && log.nausea === Number(button.dataset.score);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  const entries = sortedFatigueEntries(log);
  const axis = document.getElementById("fatigueAxis");
  if (axis) {
    axis.innerHTML = fatigueChartHTML(entries);
    paintFatigueChart(entries);
  }
  const entryList = document.getElementById("fatigueEntryList");
  if (entryList) entryList.innerHTML = fatigueEntryListHTML(entries);

  const legacy = document.getElementById("legacyFatigueNote");
  if (legacy) {
    const notes = [];
    if (log && log.fatigue != null) notes.push(`時間の指定がない記録: ${log.fatigue}`);
    const slotText = FATIGUE_SLOTS.filter((slot) => fatigueSlotScore(log, slot.key) != null)
      .map((slot) => `${slot.label}${fatigueSlotScore(log, slot.key)}`)
      .join(" ");
    if (slotText) notes.push(`以前の時間帯: ${slotText}`);
    legacy.classList.toggle("hidden", notes.length === 0);
    legacy.textContent = notes.join("　");
  }

  const logs = [...(state.symptomLogs || [])].sort((a, b) => b.date.localeCompare(a.date));
  summary.textContent = logs.length ? `これまでの記録（${logs.length}日）` : "これまでの記録";
  history.innerHTML = logs.length
    ? logs
        .map((item) => {
          const current = item.date === day ? " is-current" : "";
          const currentAttr = item.date === day ? ' aria-current="date"' : "";
          return `<button type="button" class="symptom-day${current}" data-date="${item.date}"${currentAttr}>
            <span class="symptom-day-date">${fmtDate(item.date)}(${weekdayChar(item.date)})</span>
            <span class="symptom-day-scores">${symptomLine(item, "—")}</span>
          </button>`;
        })
        .join("")
    : `<div class="empty-state">まだ記録がありません。</div>`;
}

function sumMeals(meals) {
  return meals.reduce(
    (acc, m) => {
      acc.calories += Number(m.calories) || 0;
      acc.protein += Number(m.protein) || 0;
      acc.fat += Number(m.fat) || 0;
      acc.carbs += Number(m.carbs) || 0;
      return acc;
    },
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
}

function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + deltaDays));
}

function dayReportForClaude(dateStr) {
  const r = (v) => Math.round(v);
  const lines = [`【食事分析の依頼】${dateStr}`];
  const p = state.profile;
  const weightEntry = getWeightAsOf(dateStr);
  const targets = p && weightEntry ? computeTargets(p, weightEntry.weight) : null;

  if (p) {
    lines.push(
      `プロフィール: ${p.gender === "female" ? "女性" : "男性"} ${p.age}歳 ${p.height}cm 活動係数${p.activity} 増量上乗せ+${p.surplus || 0}kcal${p.targetWeight ? ` 目標体重${p.targetWeight}kg` : ""}`
    );
  }
  if (weightEntry) {
    const weekAgo = getWeightAsOf(shiftDateStr(dateStr, -7));
    const diff = weekAgo && weekAgo !== weightEntry ? ` (7日前比 ${weightEntry.weight - weekAgo.weight >= 0 ? "+" : ""}${(weightEntry.weight - weekAgo.weight).toFixed(1)}kg)` : "";
    lines.push(`体重: ${weightEntry.weight}kg (${weightEntry.date}時点)${diff}`);
  }
  if (targets) {
    lines.push(`1日の目標: ${targets.calories}kcal / P${targets.protein}g / F${targets.fat}g / C${targets.carb}g`);
  }

  const dayMeals = state.meals
    .filter((m) => m.date === dateStr)
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  lines.push("", "食事:");
  if (dayMeals.length) {
    dayMeals.forEach((m) => {
      lines.push(
        `- ${m.time || "--:--"} ${m.type} ${m.name}: ${r(Number(m.calories) || 0)}kcal P${r(Number(m.protein) || 0)} F${r(Number(m.fat) || 0)} C${r(Number(m.carbs) || 0)}${m.memo ? ` (${m.memo})` : ""}`
      );
    });
  } else {
    lines.push("- 記録なし");
  }
  const t = sumMeals(dayMeals);
  let totalLine = `合計: ${r(t.calories)}kcal / P${r(t.protein)}g / F${r(t.fat)}g / C${r(t.carbs)}g`;
  if (targets) {
    const sign = (v) => (v >= 0 ? "+" : "") + r(v);
    totalLine += ` (目標との差 ${sign(t.calories - targets.calories)}kcal / P${sign(t.protein - targets.protein)} / F${sign(t.fat - targets.fat)} / C${sign(t.carbs - targets.carb)})`;
  }
  lines.push(totalLine);

  const dayWorkouts = state.workouts.filter((w) => w.date === dateStr);
  lines.push(
    "",
    `筋トレ: ${dayWorkouts.length ? dayWorkouts.map((w) => w.name + (w.memo ? `(${w.memo})` : "")).join("、") : "なし"}`
  );

  const recentDays = [];
  for (let i = 7; i >= 1; i--) recentDays.push(shiftDateStr(dateStr, -i));
  const loggedDays = recentDays.filter((d) => state.meals.some((m) => m.date === d));
  if (loggedDays.length) {
    const recent = sumMeals(state.meals.filter((m) => loggedDays.includes(m.date)));
    const n = loggedDays.length;
    lines.push(
      `直近7日(記録のある${n}日)の平均: ${r(recent.calories / n)}kcal / P${r(recent.protein / n)}g / F${r(recent.fat / n)}g / C${r(recent.carbs / n)}g`
    );
  }
  const workoutDays = new Set(state.workouts.filter((w) => recentDays.includes(w.date)).map((w) => w.date));
  lines.push(`直近7日の筋トレ: ${workoutDays.size}日`);
  return lines.join("\n");
}

async function copyDayForClaude() {
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  const text = dayReportForClaude(dateStr);
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました。Claudeのプロジェクトに貼ってください");
  } catch (error) {
    prompt("この文章をコピーしてClaudeに貼ってください", text);
  }
}

function renderDashboard() {
  const dateStr = document.getElementById("dashboardDate").value || todayStr();
  renderSymptoms(dateStr);
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
  const totals = sumMeals(dayMeals);

  renderMacroCards(totals, targets);
  renderWeightChart("weightChart", state.weightLogs, 30);
  renderCalorieChart("calorieChart", mealDailyTotals(), 30, targets.calories);

  const mealsListEl = document.getElementById("todayMealsList");
  mealsListEl.innerHTML = dayMeals.length
    ? dayMeals.map((m) => mealItemHTML(m, false)).join("")
    : `<div class="empty-state">この日の食事記録はまだありません。「食事」タブから追加してください。</div>`;

  const dayWorkouts = state.workouts.filter((w) => w.date === dateStr);
  const workoutListEl = document.getElementById("todayWorkoutList");
  workoutListEl.innerHTML = dayWorkouts.length
    ? dayWorkouts.map((w) => workoutItemHTML(w, false)).join("")
    : `<div class="empty-state">この日のトレーニング記録はまだありません。「筋トレ」タブから追加してください。</div>`;
}

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

  let ingredients = [];
  let lastAutoName = "";

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

function initWorkouts() {
  const dateInput = document.getElementById("workoutsDate");
  dateInput.value = todayStr();
  dateInput.addEventListener("change", renderWorkouts);

  initWorkoutCalendar();
  initBodyPartPicker();

  document.getElementById("workoutForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (selectedBodyParts.size === 0) return;

    const date = dateInput.value || todayStr();
    const memo = document.getElementById("workoutMemo").value.trim();
    selectedBodyParts.forEach((part) => {
      state.workouts.push({ id: uid(), date, name: part, memo });
    });
    saveState();
    e.target.reset();
    setSelectedBodyParts(new Set());
    renderWorkouts();
    toast("トレーニングを記録しました");
  });

  document.getElementById("workoutsList").addEventListener("click", (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    deleteWithUndo("workouts", btn.dataset.id, renderWorkouts, "トレーニングの記録");
  });
}

let selectedBodyParts = new Set();

function initBodyPartPicker() {
  const picker = document.getElementById("bodyPartPicker");
  if (!picker) return;

  picker.addEventListener("click", (e) => {
    const btn = e.target.closest(".body-part-btn");
    if (!btn) return;
    const next = new Set(selectedBodyParts);
    if (next.has(btn.dataset.part)) {
      next.delete(btn.dataset.part);
    } else {
      next.add(btn.dataset.part);
    }
    setSelectedBodyParts(next);
  });
}

function setSelectedBodyParts(parts) {
  selectedBodyParts = parts;
  document.querySelectorAll("#bodyPartPicker .body-part-btn").forEach((btn) => {
    const isSelected = selectedBodyParts.has(btn.dataset.part);
    btn.classList.toggle("is-selected", isSelected);
    btn.setAttribute("aria-pressed", String(isSelected));
  });
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

let workoutCalMonth = null;

const CANONICAL_BODY_PARTS = ["胸", "背中", "脚", "肩", "腕", "体幹・腹筋"];
const LEGACY_EXERCISE_GROUP = {
  "ベンチプレス": "胸",
  "インクラインベンチプレス": "胸",
  "ダンベルフライ": "胸",
  "腕立て伏せ(プッシュアップ)": "胸",
  "デッドリフト": "背中",
  "懸垂(チンニング)": "背中",
  "ラットプルダウン": "背中",
  "ベントオーバーロウ": "背中",
  "ダンベルロウ": "背中",
  "スクワット": "脚",
  "レッグプレス": "脚",
  "レッグエクステンション": "脚",
  "レッグカール": "脚",
  "ランジ": "脚",
  "カーフレイズ": "脚",
  "ショルダープレス": "肩",
  "サイドレイズ": "肩",
  "リアレイズ": "肩",
  "アームカール(バイセップスカール)": "腕",
  "トライセプスエクステンション": "腕",
  "ディップス": "腕",
  "プランク": "体幹・腹筋",
  "クランチ(腹筋)": "体幹・腹筋",
  "レッグレイズ": "体幹・腹筋",
};
function exerciseGroupOf(name) {
  if (CANONICAL_BODY_PARTS.includes(name)) return name;
  return LEGACY_EXERCISE_GROUP[name] || "その他";
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

function initWeight() {
  document.getElementById("weightDate").value = todayStr();
  document.getElementById("weightTime").value = nowTimeStr();

  document.getElementById("weightForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = document.getElementById("weightDate").value || todayStr();
    const time = document.getElementById("weightTime").value || nowTimeStr();
    const weight = Number(document.getElementById("weightValue").value);
    if (!weight) return;
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

  const parts = [
    `<span>記録開始 ${first.weight}kg(${fmtDate(first.date)})</span>`,
    `<span>増減 <b class="${diffClass}">${diffText}</b></span>`,
    `<span>記録数 ${sorted.length}件</span>`,
  ];

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
    if (windowed.length < 2 && sorted.length >= 2) windowed = sorted.slice(-2);
  }
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  if (!canvas.dataset.baseHeight) {
    canvas.dataset.baseHeight = String(Number(canvas.getAttribute("height")) || 140);
  }
  const cssHeight = Number(canvas.dataset.baseHeight);
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
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
    ctx.font = "12px 'Gaegu', 'Yomogi', sans-serif";
    ctx.fillText(opts.noDataText, 8, cssHeight / 2);
    return;
  }
  if (windowed.length === 1) {
    ctx.fillStyle = muted;
    ctx.font = "12px 'Gaegu', 'Yomogi', sans-serif";
    ctx.fillText(opts.singlePointText(windowed[0].value, windowed[0].date), 8, cssHeight / 2);
    return;
  }

  const latest = windowed[windowed.length - 1];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = text;
  ctx.font = "bold 15px 'Gaegu', 'Yomogi', sans-serif";
  const headline = opts.headline(latest.value);
  ctx.fillText(headline, 8, 14);
  ctx.font = "10px 'Gaegu', 'Yomogi', sans-serif";
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

  const graphite = styles.getPropertyValue("--graphite").trim() || border;
  ctx.strokeStyle = graphite;
  ctx.fillStyle = muted;
  ctx.font = "10px 'Gaegu', 'Yomogi', sans-serif";
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const val = min + ((max - min) * i) / gridLines;
    const yy = y(val);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    pencilLineTo(ctx, padL, yy, cssWidth - padR, yy, i + 1);
    ctx.stroke();
    ctx.restore();
    ctx.fillText(opts.axisLabel(val), cssWidth - padR + 6, yy + 3);
  }

  const labelCount = Math.min(5, windowed.length);
  const labelIndices = [...new Set(
    Array.from({ length: labelCount }, (_, i) =>
      labelCount === 1 ? 0 : Math.round((i * (windowed.length - 1)) / (labelCount - 1))
    )
  )];
  ctx.save();
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = graphite;
  ctx.globalAlpha = 0.18;
  labelIndices.forEach((i) => {
    const px = x(i);
    ctx.beginPath();
    pencilLineTo(ctx, px, padT, px, padT + plotH, i + 11);
    ctx.stroke();
  });
  ctx.restore();

  ctx.fillStyle = muted;
  ctx.font = "10px 'Gaegu', 'Yomogi', sans-serif";
  labelIndices.forEach((i, idx) => {
    const label = fmtDate(windowed[i].date);
    const w = ctx.measureText(label).width;
    let tx = x(i) - w / 2;
    if (idx === 0) tx = Math.max(tx, padL);
    if (idx === labelIndices.length - 1) tx = Math.min(tx, cssWidth - padR - w);
    ctx.fillText(label, tx, cssHeight - 4);
  });

  if (opts.targetValue) {
    const ty = y(Number(opts.targetValue));
    ctx.save();
    ctx.strokeStyle = orange;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    pencilLineTo(ctx, padL, ty, cssWidth - padR, ty, 7);
    ctx.stroke();
    ctx.restore();
  }

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

  const fillPath = new Path2D(linePath);
  fillPath.lineTo(x(windowed.length - 1), padT + plotH);
  fillPath.lineTo(x(0), padT + plotH);
  fillPath.closePath();
  const gradient = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  gradient.addColorStop(0, color_mix_fallback(primary, 0.22));
  gradient.addColorStop(1, color_mix_fallback(primary, 0));
  ctx.save();
  const hatchFill = pencilHatch(ctx, primary, dpr);
  if (hatchFill && pencilTex.hatch) ctx.globalAlpha = 0.5;
  ctx.fillStyle = hatchFill || gradient;
  ctx.fill(fillPath);
  ctx.restore();

  ctx.strokeStyle = primary;
  ctx.lineWidth = 2.1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(linePath);
  ctx.save();
  ctx.translate(0.8, -0.7);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.1;
  ctx.stroke(linePath);
  ctx.restore();

  const jit = (i, k) => {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s) - 0.5;
  };
  windowed.forEach((p, i) => {
    const isLast = i === windowed.length - 1;
    const r = isLast ? 4.5 : 3.2;
    const cx = x(i);
    const cy = y(p.value);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r + jit(i, 7) * 0.8, r + jit(i, 8) * 0.8, jit(i, 9), 0, Math.PI * 2);
    ctx.fillStyle = isLast ? primary : surfaceAlt;
    ctx.fill();
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = primary;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy - 0.4, r + 0.6, -2.4 + jit(i, 10), 0.9 + jit(i, 11));
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  pencilGrain(ctx, padL - 6, padT - 6, plotW + 10, plotH + 10);
  if (opts.targetValue) {
    ctx.fillStyle = orange;
    ctx.font = "10px 'Gaegu', 'Yomogi', sans-serif";
    ctx.fillText(opts.targetLabel(opts.targetValue), padL + 4, y(Number(opts.targetValue)) - 4);
  }
}

function pencilLineTo(ctx, x1, y1, x2, y2, seed) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const steps = Math.max(2, Math.round(len / 14));
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  ctx.moveTo(x1, y1);
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const n = k === steps ? 0 : ((Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453) % 1) * 0.9;
    ctx.lineTo(x1 + (x2 - x1) * t + nx * n, y1 + (y2 - y1) * t + ny * n);
  }
}

const PENCIL_TEX_SCALE = 3;
const pencilTex = { hatch: null, grain: null };
const pencilTexReady = Promise.all(
  ["hatch", "grain"].map((name) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { pencilTex[name] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = `css/tex/${name}.png`;
  }))
);
const pencilHatchTiles = new Map();

function pencilTexPattern(ctx, image) {
  const pattern = ctx.createPattern(image, "repeat");
  if (pattern && pattern.setTransform && typeof DOMMatrix === "function") {
    pattern.setTransform(new DOMMatrix([1 / PENCIL_TEX_SCALE, 0, 0, 1 / PENCIL_TEX_SCALE, 0, 0]));
  }
  return pattern;
}

function pencilGrain(ctx, x, y, w, h) {
  if (!pencilTex.grain) return;
  const pattern = pencilTexPattern(ctx, pencilTex.grain);
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function pencilHatch(ctx, hex, dpr) {
  if (pencilTex.hatch) {
    let tile = pencilHatchTiles.get(hex);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.width = pencilTex.hatch.naturalWidth;
      tile.height = pencilTex.hatch.naturalHeight;
      const t = tile.getContext("2d");
      if (t) {
        t.drawImage(pencilTex.hatch, 0, 0);
        t.globalCompositeOperation = "source-in";
        t.fillStyle = hex;
        t.fillRect(0, 0, tile.width, tile.height);
        pencilHatchTiles.set(hex, tile);
      }
    }
    const pattern = pencilTexPattern(ctx, tile);
    if (pattern) return pattern;
  }
  const size = 6;
  const tile = document.createElement("canvas");
  tile.width = tile.height = Math.round(size * dpr);
  const t = tile.getContext("2d");
  if (!t) return null;
  t.scale(dpr, dpr);
  t.strokeStyle = color_mix_fallback(hex, 0.34);
  t.lineWidth = 1;
  t.beginPath();
  t.moveTo(-1, size + 1);
  t.lineTo(size + 1, -1);
  t.moveTo(-1, 1);
  t.lineTo(1, -1);
  t.moveTo(size - 1, size + 1);
  t.lineTo(size + 1, size - 1);
  t.stroke();
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern && pattern.setTransform && typeof DOMMatrix === "function") {
    pattern.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  }
  return pattern;
}

function color_mix_fallback(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
      state.symptomLogs = sanitizeSymptomLogs(state.symptomLogs);
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
  if (!confirm("すべての記録(食事・トレーニング・体重・疲労・吐き気・プロフィール)を削除します。元に戻せません。よろしいですか?")) return;
  if (!confirm("本当によろしいですか? この操作は取り消せません。")) return;
  state = structuredClone(DEFAULT_STATE);
  saveState();
  renderAll();
  toast("すべてのデータを削除しました");
}

let toastTimer = null;

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
  window.addEventListener("resize", redrawCharts);
  // グラフの字は canvas に描くので、手書きフォントの読み込みが終わる前に描いた分は
  // 代わりのフォントのまま残る。読み込みが終わったら1回だけ描き直す(見た目だけ)。
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(redrawCharts).catch(() => {});
  }
  pencilTexReady.then(redrawCharts).catch(() => {});
}

function redrawCharts() {
  renderWeightChart("weightChart", state.weightLogs, 30);
  const days = weightChartRange === "all" ? null : Number(weightChartRange);
  renderWeightChart("weightChartFull", state.weightLogs, days, state.profile && state.profile.targetWeight);
  const dailyTotals = mealDailyTotals();
  renderCalorieChart("calorieChart", dailyTotals, 30, currentTargetCalories());
  const calorieDays = calorieChartRange === "all" ? null : Number(calorieChartRange);
  renderCalorieChart("calorieChartFull", dailyTotals, calorieDays, currentTargetCalories());
}

document.addEventListener("DOMContentLoaded", init);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => reg.update().catch(() => {}))
      .catch((err) => console.warn("Service worker registration failed:", err));

    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  });
}
