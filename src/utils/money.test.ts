import assert from "node:assert/strict";
import { test } from "node:test";
import { amountSchema, dateSchema, toCents } from "./money";

test("amounts are normalised to two decimals", () => {
  assert.equal(amountSchema.parse("45.5"), "45.50");
  assert.equal(amountSchema.parse(120), "120.00");
});

test("zero, negative, malformed and over-precise amounts are rejected", () => {
  for (const bad of ["0", "-5", "abc", "", "1.234", "1e5", null]) {
    assert.equal(amountSchema.safeParse(bad).success, false, String(bad));
  }
});

test("a null target stays null for open-ended goals", () => {
  assert.equal(amountSchema.nullable().optional().parse(null), null);
  assert.equal(amountSchema.nullable().optional().parse(undefined), undefined);
});

test("invalid dates are rejected", () => {
  assert.equal(dateSchema.safeParse("2026-11-05").success, true);
  assert.equal(dateSchema.safeParse("not a date").success, false);
});

test("toCents avoids float drift", () => {
  assert.equal(toCents("19.99"), 1999);
  assert.equal(toCents("1.10"), 110);
});
