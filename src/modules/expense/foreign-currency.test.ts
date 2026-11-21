import { test } from "node:test";
import assert from "node:assert/strict";
import { toRupees } from "./foreign-currency";

test("works out the rupee amount from the foreign amount and rate", () => {
  const { amount, foreign } = toRupees({ originalAmount: "12.50", originalCurrency: "usd", exchangeRate: "83.25" });
  assert.equal(amount, "1040.63");
  assert.deepEqual(foreign, { originalAmount: "12.50", originalCurrency: "USD", exchangeRate: "83.25" });
});

test("small rates keep their precision", () => {
  assert.equal(toRupees({ originalAmount: "150000", originalCurrency: "IDR", exchangeRate: "0.005312" }).amount, "796.80");
});

test("rejects unknown currencies, bad amounts and bad rates", () => {
  assert.throws(() => toRupees({ originalAmount: "10", originalCurrency: "XYZ", exchangeRate: "1" }));
  assert.throws(() => toRupees({ originalAmount: "0", originalCurrency: "USD", exchangeRate: "83" }));
  assert.throws(() => toRupees({ originalAmount: "10.123", originalCurrency: "USD", exchangeRate: "83" }));
  assert.throws(() => toRupees({ originalAmount: "10", originalCurrency: "USD", exchangeRate: "-1" }));
  assert.throws(() => toRupees({ originalAmount: "10", originalCurrency: "USD", exchangeRate: "" }));
});

test("rejects amounts that round to nothing", () => {
  assert.throws(() => toRupees({ originalAmount: "0.01", originalCurrency: "IDR", exchangeRate: "0.000001" }));
});
