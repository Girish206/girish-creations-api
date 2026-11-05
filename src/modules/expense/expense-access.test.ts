import assert from "node:assert/strict";
import { test } from "node:test";
import { mayChangeExpense } from "./expense.service";

const expense = { paidByAdminUserId: 1n, createdByAdminUserId: 2n };

test("whoever paid or logged an expense can change it", () => {
  assert.equal(mayChangeExpense(expense, { id: 1n, isSuperAdmin: false }), true);
  assert.equal(mayChangeExpense(expense, { id: 2n, isSuperAdmin: false }), true);
});

test("someone who only shares an expense can't, but a super admin can", () => {
  assert.equal(mayChangeExpense(expense, { id: 3n, isSuperAdmin: false }), false);
  assert.equal(mayChangeExpense(expense, { id: 3n, isSuperAdmin: true }), true);
});

test("an expense from before logging was recorded is the payer's", () => {
  const older = { paidByAdminUserId: 1n, createdByAdminUserId: null };
  assert.equal(mayChangeExpense(older, { id: 1n, isSuperAdmin: false }), true);
  assert.equal(mayChangeExpense(older, { id: 3n, isSuperAdmin: false }), false);
});
