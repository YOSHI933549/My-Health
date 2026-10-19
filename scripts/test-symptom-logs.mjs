import assert from "node:assert/strict";
import { loadApp } from "./test-helpers/load-app.mjs";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const meals = [{ id: "m1", date: "2026-01-02", time: "12:00", type: "昼食", name: "fixture", calories: 100, protein: 1, fat: 1, carbs: 1, memo: "", photo: null }];
const weightLogs = [{ id: "w1", date: "2026-01-02", time: "08:00", weight: 70 }];
const workouts = [{ id: "t1", date: "2026-01-02", name: "脚", memo: "" }];
const profile = { height: 170, age: 30, gender: "male", activity: "1.55", surplus: 400, fatRatio: 25 };

const legacy = {
  profile,
  weightLogs,
  meals,
  workouts,
  importedMealIds: ["link:fixture"],
  uiZoom: 1,
};

{
  const { context, saved, raw, before } = loadApp(legacy);
  assert.equal(raw(), before);
  const loaded = plain(context.loadState());
  assert.deepEqual(loaded.meals, meals);
  assert.deepEqual(loaded.weightLogs, weightLogs);
  assert.deepEqual(loaded.workouts, workouts);
  assert.deepEqual(loaded.profile, profile);
  assert.deepEqual(loaded.importedMealIds, ["link:fixture"]);
  assert.deepEqual(loaded.symptomLogs, []);
  assert.equal(loaded.uiZoom, 1);

  context.setSymptom("2026-01-02", "fatigue", 4);
  context.setSymptom("2026-01-02", "nausea", 1);
  const stored = saved();
  assert.deepEqual(stored.meals, meals);
  assert.deepEqual(stored.weightLogs, weightLogs);
  assert.deepEqual(stored.workouts, workouts);
  assert.deepEqual(stored.profile, profile);
  assert.deepEqual(stored.importedMealIds, ["link:fixture"]);
  assert.equal(stored.uiZoom, 1);
  assert.equal(stored.symptomLogs.length, 1);
  assert.equal(stored.symptomLogs[0].date, "2026-01-02");
  assert.equal(stored.symptomLogs[0].fatigue, 4);
  assert.equal(stored.symptomLogs[0].nausea, 1);
  assert.deepEqual(Object.keys(stored.symptomLogs[0]).sort(), ["date", "fatigue", "id", "nausea"]);

  context.setSymptom("2026-01-02", "headache", 5);
  context.setSymptom("2026-01-02", "fatigue", 9);
  assert.equal(saved().symptomLogs[0].fatigue, 4);
  assert.equal(saved().symptomLogs[0].headache, undefined);

  context.setSymptom("2026-01-02", "fatigue", null);
  context.setSymptom("2026-01-02", "nausea", null);
  assert.deepEqual(saved().symptomLogs, []);
  assert.deepEqual(saved().meals, meals);
  assert.equal(context.symptomSummaryText(), "");
}

{
  const { context } = loadApp({
    ...legacy,
    symptomLogs: [
      { id: "s1", date: "2026-01-01", fatigue: 4, nausea: 1, headache: 5 },
      { id: "bad", date: "2026-02-31", fatigue: 3, nausea: 3 },
      { id: "s3", date: "2026-01-01", fatigue: 2, nausea: null },
      { date: "2026-01-03", fatigue: "9", nausea: "2" },
      { date: "nope", fatigue: 1, nausea: 1 },
      { date: "2026-01-04", fatigue: null, nausea: null },
    ],
  });
  const loaded = plain(context.loadState());
  assert.deepEqual(
    loaded.symptomLogs.map(({ id, ...rest }) => rest),
    [
      { date: "2026-01-01", fatigue: 2, nausea: null },
      { date: "2026-01-03", fatigue: null, nausea: 2 },
    ]
  );
  assert.equal(loaded.symptomLogs[0].id, "s3");
  assert.equal(typeof loaded.symptomLogs[1].id, "string");
  assert.ok(loaded.symptomLogs[1].id.length > 0);
  assert.equal(loaded.symptomLogs.some((log) => Object.prototype.hasOwnProperty.call(log, "headache")), false);
  assert.deepEqual(loaded.meals, meals);
  assert.equal(
    context.symptomSummaryText(),
    [
      "疲労と吐き気（1が軽い、5が強い）",
      "2026-01-01 吐き気 未記録 ・ 疲労 時間なし2",
      "2026-01-03 吐き気 2 ・ 疲労 未記録",
    ].join("\n")
  );
}

{
  const { context, saved, raw, before } = loadApp({
    ...legacy,
    symptomLogs: [{ id: "s9", date: "2026-01-02", fatigue: 4, nausea: 1 }],
  });
  assert.equal(raw(), before);
  const loaded = plain(context.loadState());
  assert.equal(loaded.symptomLogs.length, 1);
  assert.equal(loaded.symptomLogs[0].id, "s9");
  assert.equal(loaded.symptomLogs[0].fatigue, 4);
  assert.equal(loaded.symptomLogs[0].nausea, 1);
  assert.equal(loaded.symptomLogs[0].fatigueSlots, undefined);
  assert.deepEqual(loaded.meals, meals);
  assert.deepEqual(loaded.weightLogs, weightLogs);

  context.setFatigueSlot("2026-01-02", "morning", 2);
  context.setFatigueSlot("2026-01-02", "night", 5);
  context.setFatigueSlot("2026-01-02", "dawn", 3);
  context.setFatigueSlot("2026-01-02", "evening", 9);
  const stored = saved();
  assert.equal(stored.symptomLogs[0].id, "s9");
  assert.equal(stored.symptomLogs[0].fatigue, 4);
  assert.equal(stored.symptomLogs[0].nausea, 1);
  assert.deepEqual(stored.symptomLogs[0].fatigueSlots, { morning: 2, night: 5 });
  assert.deepEqual(stored.meals, meals);
  assert.deepEqual(stored.weightLogs, weightLogs);
  assert.deepEqual(stored.workouts, workouts);
  assert.equal(
    context.symptomSummaryText(),
    "疲労と吐き気（1が軽い、5が強い）\n2026-01-02 吐き気 1 ・ 疲労 時間なし4 朝2 夜5"
  );

  context.setFatigueSlot("2026-01-02", "morning", null);
  assert.equal(saved().symptomLogs[0].fatigue, 4);
  assert.deepEqual(saved().symptomLogs[0].fatigueSlots, { night: 5 });

  context.setSymptom("2026-01-02", "nausea", null);
  assert.equal(saved().symptomLogs[0].fatigue, 4);
  assert.equal(saved().symptomLogs[0].nausea, null);
  assert.deepEqual(saved().symptomLogs[0].fatigueSlots, { night: 5 });
  assert.deepEqual(saved().meals, meals);
}

{
  const { context, saved, raw, before } = loadApp({
    ...legacy,
    symptomLogs: [
      {
        id: "s9",
        date: "2026-01-02",
        fatigue: 4,
        nausea: 1,
        fatigueSlots: { morning: 2, night: 5 },
        fatigueEntries: [
          { id: "e1", time: "15:40", score: 5 },
          { id: "bad", time: "25:00", score: 3 },
          { id: "e2", time: "08:05", score: "2" },
        ],
      },
    ],
  });
  assert.equal(raw(), before);
  const loaded = plain(context.loadState());
  assert.equal(loaded.symptomLogs[0].fatigue, 4);
  assert.equal(loaded.symptomLogs[0].nausea, 1);
  assert.equal(loaded.symptomLogs[0].id, "s9");
  assert.deepEqual(loaded.symptomLogs[0].fatigueSlots, { morning: 2, night: 5 });
  assert.deepEqual(
    loaded.symptomLogs[0].fatigueEntries.map(({ id, ...rest }) => ({ id, ...rest })),
    [
      { id: "e2", time: "08:05", score: 2 },
      { id: "e1", time: "15:40", score: 5 },
    ]
  );
  assert.deepEqual(loaded.meals, meals);

  context.addFatigueEntry("2026-01-02", 3, "12:10");
  context.addFatigueEntry("2026-01-02", 1, "08:05");
  const stored = saved();
  assert.equal(stored.symptomLogs[0].fatigue, 4);
  assert.equal(stored.symptomLogs[0].nausea, 1);
  assert.deepEqual(stored.symptomLogs[0].fatigueSlots, { morning: 2, night: 5 });
  assert.equal(stored.symptomLogs[0].fatigueEntries.filter((entry) => entry.time === "08:05").length, 2);
  assert.equal(stored.meals[0].name, meals[0].name);
  assert.equal(stored.weightLogs[0].weight, weightLogs[0].weight);

  const added = stored.symptomLogs[0].fatigueEntries.find((entry) => entry.time === "12:10");
  context.updateFatigueEntryTime("2026-01-02", added.id, "12:45");
  assert.equal(saved().symptomLogs[0].fatigueEntries.find((entry) => entry.id === added.id).time, "12:45");
  assert.equal(saved().symptomLogs[0].fatigue, 4);
  context.updateFatigueEntryTime("2026-01-02", added.id, "99:99");
  assert.equal(saved().symptomLogs[0].fatigueEntries.find((entry) => entry.id === added.id).time, "12:45");

  context.deleteFatigueEntry("2026-01-02", added.id);
  const afterDelete = saved().symptomLogs[0];
  assert.equal(afterDelete.fatigueEntries.some((entry) => entry.id === added.id), false);
  assert.equal(afterDelete.fatigue, 4);
  assert.equal(afterDelete.nausea, 1);
  assert.deepEqual(afterDelete.fatigueSlots, { morning: 2, night: 5 });
  assert.deepEqual(saved().meals, meals);
  assert.match(context.symptomSummaryText(), /時間なし4/);
  assert.match(context.symptomSummaryText(), /朝2/);
  assert.match(context.symptomSummaryText(), /08:05は2/);
  assert.match(context.symptomSummaryText(), /15:40は5/);
  assert.doesNotMatch(context.symptomSummaryText(), /12:45/);
}

{
  const { context } = loadApp();
  const chart = context.fatigueChartHTML([
    { id: "b", time: "21:10", score: 5 },
    { id: "a", time: "08:05", score: 2 },
  ]);
  assert.match(chart, /aria-label="疲労の推移。08:05 は 2、21:10 は 5。平均 3\.5"/);
  assert.match(chart, /fatigue-chart-y/);
  for (const score of [1, 2, 3, 4, 5]) assert.match(chart, new RegExp(`>${score}<`));
  assert.match(chart, />0時</);
  assert.match(chart, />6</);
  assert.match(chart, />12</);
  assert.match(chart, />18</);
  assert.match(chart, />24時</);
  assert.match(chart, /fatigue-chart-canvas/);
  assert.match(chart, /data-points="/);
  assert.doesNotMatch(chart, /fatigue-mark/);
  assert.doesNotMatch(chart, /<b>2<\/b>/);
  assert.doesNotMatch(chart, /<b>5<\/b>/);
  const plotted = chart.match(/data-points="([^"]+)"/)[1].split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
  assert.equal(plotted.length, 2);
  assert.ok(plotted[0].x < plotted[1].x);
  assert.ok(plotted[1].y < plotted[0].y);

  const one = context.fatigueChartHTML([{ id: "a", time: "16:20", score: 4 }]);
  assert.match(one, /aria-label="疲労の推移。16:20 は 4"/);
  assert.doesNotMatch(one, /平均/);
  assert.doesNotMatch(one, /fatigue-mark/);
  assert.doesNotMatch(one, /<b>4<\/b>/);
  assert.doesNotMatch(one, /<small>16:20<\/small>/);
  assert.match(one, /fatigue-chart-canvas/);
  assert.doesNotMatch(one, /data-points=/);

  const empty = context.fatigueChartHTML([]);
  assert.match(empty, /この日の時刻の記録はまだありません/);
  assert.doesNotMatch(empty, /平均/);
  assert.match(empty, />5</);
  assert.match(empty, />0時</);
  assert.match(empty, />24時</);
  assert.doesNotMatch(empty, /fatigue-mark/);
}

console.log("symptom log tests passed");
