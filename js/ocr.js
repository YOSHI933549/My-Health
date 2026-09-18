/* ==========================================================================
   栄養成分表示の写真から自動入力(任意機能)
   ==========================================================================
   Tesseract.js(OCRライブラリ)を使って、写真をブラウザ内だけで解析する。
   サーバーには一切送信しない。画像は解析にのみ使い、保存もしない。

   ライブラリ本体は初回利用時に初めてCDNから動的に読み込む(常にページの
   読み込みを重くしないため)。「エネルギー/たんぱく質/脂質/炭水化物」の
   行から数値を抜き出してカロリー・PFC入力欄に反映するが、OCRの誤読は
   十分あり得るため、自動送信はせず必ず内容の確認を促す。
   ========================================================================== */

const TESSERACT_CDN_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      tesseractLoadPromise = null;
      reject(new Error("OCRライブラリの読み込みに失敗しました(通信環境をご確認ください)"));
    };
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

/**
 * 全角の数字・英字・記号(０-９Ａ-Ｚａ-ｚ／：－ｇ等)と全角スペースを半角化する。
 * OCRは日本語ラベルの数値や単位を全角で読み取ることがあり、そのままだと
 * 半角前提の正規表現(\d や kcal/g)にマッチしないため。
 */
function toHalfWidth(str) {
  return str
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/**
 * OCRで読み取ったテキストから栄養成分の数値を抜き出す。
 * 見つからない項目は null のまま返す(呼び出し側で既存の値を維持できるように)。
 */
function parseNutritionLabel(text) {
  const norm = toHalfWidth(text.replace(/[\r\n]+/g, " "));
  // 「1,234」のような桁区切りカンマは数値として読めないので、カンマの前後が
  // 数字のときだけ取り除く(文中の読点と混同しないように限定的に)。
  const numPattern = "(\\d[\\d,]*(?:\\.\\d+)?)";
  const grab = (patterns) => {
    for (const re of patterns) {
      const m = norm.match(re);
      if (m) return Number(m[1].replace(/,/g, ""));
    }
    return null;
  };
  return {
    calories: grab([
      new RegExp(`エネルギ[ーー―]?\\s*[:：]?\\s*${numPattern}\\s*kcal`, "i"),
      new RegExp(`${numPattern}\\s*kcal`, "i"),
    ]),
    protein: grab([new RegExp(`(?:たんぱく質|タンパク質)\\s*[:：]?\\s*${numPattern}\\s*g`, "i")]),
    fat: grab([new RegExp(`脂質\\s*[:：]?\\s*${numPattern}\\s*g`, "i")]),
    carbs: grab([new RegExp(`炭水化物\\s*[:：]?\\s*${numPattern}\\s*g`, "i")]),
  };
}

async function ocrNutritionLabel(file) {
  await loadTesseract();
  const { data } = await Tesseract.recognize(file, "jpn+eng");
  return { result: parseNutritionLabel(data.text), rawText: data.text };
}

function initLabelOcr() {
  const input = document.getElementById("mealLabelPhoto");
  const hint = document.getElementById("mealLabelHint");
  if (!input || !hint) return;

  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = ""; // 同じ写真を選び直せるようにその場でリセット(保存はしない)
    if (!file) return;

    hint.hidden = false;
    hint.textContent = "写真を読み取っています…(初回は少し時間がかかります)";

    try {
      const { result, rawText } = await ocrNutritionLabel(file);
      const found = ["calories", "protein", "fat", "carbs"].filter((k) => result[k] != null);
      if (found.length === 0) {
        // 何が読み取れたかコンソールに残しておく(表示は崩れるので画面には出さない)。
        // 数値の行自体が読めていない/ラベルの文言が想定と違う、を切り分ける手掛かりになる。
        console.warn("OCRで栄養成分の数値を検出できませんでした。読み取った全文:", rawText);
        hint.textContent = "数値を読み取れませんでした。ピントが合っている・ラベル全体が写っているか確認して撮り直すか、お手数ですが手動で入力してください。";
        return;
      }
      if (result.calories != null) document.getElementById("mealCalories").value = result.calories;
      if (result.protein != null) document.getElementById("mealProtein").value = result.protein;
      if (result.fat != null) document.getElementById("mealFat").value = result.fat;
      if (result.carbs != null) document.getElementById("mealCarbs").value = result.carbs;

      const fmt = (v) => (v != null ? v : "?");
      hint.textContent =
        `読み取り結果: ${fmt(result.calories)}kcal / P${fmt(result.protein)}g / ` +
        `F${fmt(result.fat)}g / C${fmt(result.carbs)}g` +
        "(誤読の可能性があるため、下の欄で内容をご確認ください)";
      toast("写真から読み取りました。内容を確認してください");
    } catch (e) {
      console.error("OCR failed", e);
      hint.textContent = "読み取りに失敗しました。手動で入力してください。";
    }
  });
}

document.addEventListener("DOMContentLoaded", initLabelOcr);
