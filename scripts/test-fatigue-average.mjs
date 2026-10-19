import assert from "node:assert/strict";
import { loadApp } from "./test-helpers/load-app.mjs";

const { fatigueDayAverage, fatigueChartHTML } = loadApp().context;

assert.equal(fatigueDayAverage([]), null);
assert.equal(fatigueDayAverage(null), null);
assert.equal(fatigueDayAverage(undefined), null);
assert.equal(fatigueDayAverage({ fatigue: 5, fatigueSlots: { morning: 1 } }), null);
assert.equal(fatigueDayAverage([{ id: "a", time: "08:00", score: 2 }]), null);

assert.equal(
  fatigueDayAverage([
    { score: 2 },
    { score: 3 },
    { score: 5 },
    { score: 3 },
  ]),
  3.3
);

// 1.25 と 1.75 は小数1桁で切り上げる。1.5 はそのまま。
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 1 }, { score: 1 }, { score: 2 }]), 1.3);
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 1 }, { score: 2 }, { score: 3 }]), 1.8);
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 2 }]), 1.5);
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 1 }, { score: 2 }]), 1.3);
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 2 }, { score: 2 }]), 1.7);
assert.equal(fatigueDayAverage([{ score: 1 }, { score: 1 }, { score: 1 }, { score: 1 }, { score: 2 }]), 1.2);
assert.equal(fatigueDayAverage([{ score: 4 }, { score: 4 }]), 4);

const mixed = [
  { score: 2 },
  { score: 0 },
  { score: 6 },
  { score: 1.5 },
  { score: Number.NaN },
  { score: "nope" },
  { score: null },
  { fatigue: 5 },
  { fatigueSlots: { morning: 1, night: 5 } },
  null,
  { score: "3" },
];
assert.equal(fatigueDayAverage(mixed), 2.5);
assert.equal(fatigueDayAverage([{ score: 4 }, { score: "x" }, { fatigue: 5 }]), null);

const kept = [
  { id: "a", time: "08:00", score: 2 },
  { id: "b", time: "12:00", score: 4 },
];
assert.equal(fatigueDayAverage(kept), 3);
assert.deepEqual(kept, [
  { id: "a", time: "08:00", score: 2 },
  { id: "b", time: "12:00", score: 4 },
]);

const chart = fatigueChartHTML([
  { id: "d", time: "21:10", score: 3 },
  { id: "a", time: "08:00", score: 2 },
  { id: "c", time: "15:40", score: 5 },
  { id: "b", time: "12:00", score: 3 },
]);
assert.match(chart, /aria-label="疲労の推移。08:00 は 2、12:00 は 3、15:40 は 5、21:10 は 3。平均 3\.3"/);

const same = fatigueChartHTML([
  { id: "a", time: "09:00", score: 4 },
  { id: "b", time: "18:00", score: 4 },
]);
assert.match(same, /平均 4\.0/);

const one = fatigueChartHTML([{ id: "a", time: "16:20", score: 4 }]);
assert.doesNotMatch(one, /平均/);
const empty = fatigueChartHTML([]);
assert.doesNotMatch(empty, /平均/);

console.log("fatigue average tests passed");
