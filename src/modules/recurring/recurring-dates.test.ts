import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, todayInIndia } from "./recurring-dates";

test("monthly keeps the day of the month", () => {
  assert.equal(nextOccurrence("2026-03-05", "monthly"), "2026-04-05");
  assert.equal(nextOccurrence("2026-12-05", "monthly"), "2027-01-05");
});

test("monthly on the 31st falls on the last day of shorter months, then returns", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextOccurrence("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextOccurrence("2028-01-30", "monthly", 30), "2028-02-29");
  assert.equal(nextOccurrence("2026-03-31", "monthly", 31), "2026-04-30");
});

test("weekly is seven days on, across months and years", () => {
  assert.equal(nextOccurrence("2026-11-28", "weekly"), "2026-12-05");
  assert.equal(nextOccurrence("2026-12-29", "weekly"), "2027-01-05");
});

test("today is the date in India", () => {
  // 20:00 UTC on 21 Nov is already 22 Nov in India.
  assert.equal(todayInIndia(new Date("2026-11-21T20:00:00Z")), "2026-11-22");
});
