import assert from "node:assert/strict";
import { loadApp } from "./test-helpers/load-app.mjs";

function points(startDate, values) {
  const [year, month, day] = startDate.split("-").map(Number);
  return values.map((value, index) => {
    const date = new Date(year, month - 1, day + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date: iso, value };
  });
}

const { sevenDayWeightAverages, dailyAverageWeights } = loadApp().context;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(plain(sevenDayWeightAverages([])), []);
assert.deepEqual(plain(sevenDayWeightAverages(null)), []);
assert.deepEqual(plain(sevenDayWeightAverages([{ date: "2026-05-01", value: 68.4 }])), [
  { date: "2026-05-01", value: null },
]);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-05-01", value: 68.4 },
    { date: "2026-05-02", value: 68.8 },
    { date: "2026-05-03", value: 69.1 },
  ])),
  [
    { date: "2026-05-01", value: null },
    { date: "2026-05-02", value: 68.6 },
    { date: "2026-05-03", value: 68.8 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages(
    points("2026-01-01", [70, 71, 72, 73, 74, 75, 76, 80])
  )),
  [
    { date: "2026-01-01", value: null },
    { date: "2026-01-02", value: 70.5 },
    { date: "2026-01-03", value: 71 },
    { date: "2026-01-04", value: 71.5 },
    { date: "2026-01-05", value: 72 },
    { date: "2026-01-06", value: 72.5 },
    { date: "2026-01-07", value: 73 },
    { date: "2026-01-08", value: 74.4 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages(points("2026-01-01", [70, 70.2, 70.5, 71, 70.8, 71.2, 71, 71.4]))),
  [
    { date: "2026-01-01", value: null },
    { date: "2026-01-02", value: 70.1 },
    { date: "2026-01-03", value: 70.2 },
    { date: "2026-01-04", value: 70.4 },
    { date: "2026-01-05", value: 70.5 },
    { date: "2026-01-06", value: 70.6 },
    { date: "2026-01-07", value: 70.7 },
    { date: "2026-01-08", value: 70.9 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-01-08", value: 80 },
    { date: "2026-01-01", value: 60 },
    { date: "2026-01-02", value: 70 },
  ])),
  [
    { date: "2026-01-01", value: null },
    { date: "2026-01-02", value: 65 },
    { date: "2026-01-08", value: 75 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-06-01", value: 80 },
    { date: "2026-06-03", value: 80 },
  ])),
  [
    { date: "2026-06-01", value: null },
    { date: "2026-06-03", value: 80 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-02-22", value: 60 },
    { date: "2026-02-23", value: 69 },
    { date: "2026-03-01", value: 71 },
  ])),
  [
    { date: "2026-02-22", value: null },
    { date: "2026-02-23", value: 64.5 },
    { date: "2026-03-01", value: 70 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-07-01", value: 65 },
    { date: "2026-07-10", value: 66 },
  ])),
  [
    { date: "2026-07-01", value: null },
    { date: "2026-07-10", value: null },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "2026-08-01", value: 65 },
    { date: "2026-08-07", value: 67 },
  ])),
  [
    { date: "2026-08-01", value: null },
    { date: "2026-08-07", value: 66 },
  ]
);

assert.deepEqual(
  plain(sevenDayWeightAverages([
    { date: "nope", value: 10 },
    { date: "2026-04-01", value: Number.NaN },
    { date: "2026-04-01", value: 70 },
    { date: "2026-04-02", value: 72 },
  ])),
  [
    { date: "2026-04-01", value: null },
    { date: "2026-04-02", value: 71 },
  ]
);

const sameDayLogs = [
  { date: "2026-04-01", weight: 70 },
  { date: "2026-04-01", weight: 70.4 },
  { date: "2026-04-02", weight: 71 },
];
assert.deepEqual(plain(dailyAverageWeights(sameDayLogs)), [
  { date: "2026-04-01", value: 70.2 },
  { date: "2026-04-02", value: 71 },
]);
assert.deepEqual(plain(sevenDayWeightAverages(dailyAverageWeights(sameDayLogs))), [
  { date: "2026-04-01", value: null },
  { date: "2026-04-02", value: 70.6 },
]);

const month = points(
  "2026-01-01",
  Array.from({ length: 30 }, (_, index) => 70 + index)
);
const monthAverage = plain(sevenDayWeightAverages(month));
assert.equal(monthAverage.length, 30);
assert.equal(monthAverage[0].value, null);
assert.equal(monthAverage[2].date, "2026-01-03");
assert.equal(monthAverage[2].value, 71);
assert.equal(monthAverage[6].date, "2026-01-07");
assert.equal(monthAverage[6].value, 73);
assert.equal(monthAverage[7].date, "2026-01-08");
assert.equal(monthAverage[7].value, 74);
assert.equal(monthAverage[29].date, "2026-01-30");
assert.equal(monthAverage[29].value, 96);

console.log("weight average tests passed");
