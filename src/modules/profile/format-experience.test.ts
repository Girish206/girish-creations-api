import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExperience } from "./profile.service";

test("experience shows both years and months when both are there", () => {
  assert.equal(formatExperience("5.71"), "5 years 8 months");
  assert.equal(formatExperience(1 + 1 / 12), "1 year 1 month");
});

test("a zero part is left out of the experience", () => {
  assert.equal(formatExperience(0.79), "9 months");
  assert.equal(formatExperience(2), "2 years");
  assert.equal(formatExperience(1 / 12), "1 month");
});

test("under a month reads naturally mid-sentence, and none at all is empty", () => {
  assert.equal(formatExperience(0.02), "less than a month");
  assert.equal(formatExperience(0), "");
  assert.equal(formatExperience("0.00"), "");
});
