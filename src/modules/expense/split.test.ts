import assert from "node:assert/strict";
import { test } from "node:test";
import { computeEqualShares, normalizeSplit, resolveCustomShares } from "./split";

const share = (adminUserId: bigint, shareAmount: string) => ({ adminUserId, shareAmount });

test("an equal split always adds up, with leftover paise going to the first people", () => {
  assert.deepEqual(
    computeEqualShares("100.00", [1n, 2n, 3n]).map((s) => s.shareAmount),
    ["33.34", "33.33", "33.33"],
  );
});

test("the payer leads an equal split, and nobody is listed twice", () => {
  assert.deepEqual(normalizeSplit([2n, 1n, 2n], 1n), [1n, 2n]);
});

test("a split with nobody else in it is no split", () => {
  assert.deepEqual(normalizeSplit([1n], 1n), []);
  assert.deepEqual(normalizeSplit([], 1n), []);
});

test("custom shares must add up to the expense", () => {
  assert.throws(() => resolveCustomShares([share(1n, "300.00"), share(2n, "500.00")], "900.00", 1n), /add up to 800.00/);
  assert.equal(resolveCustomShares([share(1n, "300.00"), share(2n, "600.00")], "900.00", 1n).length, 2);
});

test("float-unfriendly custom shares still add up exactly", () => {
  assert.equal(resolveCustomShares([share(1n, "0.10"), share(2n, "0.20")], "0.30", 1n).length, 2);
});

test("zero shares are dropped", () => {
  assert.deepEqual(resolveCustomShares([share(1n, "0.00"), share(2n, "50.00"), share(3n, "50.00")], "100.00", 1n), [
    share(2n, "50.00"),
    share(3n, "50.00"),
  ]);
});

test("the payer can cover an expense entirely for someone else", () => {
  assert.deepEqual(resolveCustomShares([share(1n, "0.00"), share(2n, "100.00")], "100.00", 1n), [share(2n, "100.00")]);
});

test("the payer taking the whole amount is no split", () => {
  assert.deepEqual(resolveCustomShares([share(1n, "100.00"), share(2n, "0.00")], "100.00", 1n), []);
});

test("someone appearing twice is rejected", () => {
  assert.throws(() => resolveCustomShares([share(2n, "50.00"), share(2n, "50.00")], "100.00", 1n), /one share/);
});
