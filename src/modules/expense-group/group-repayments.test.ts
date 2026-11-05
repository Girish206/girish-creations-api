import assert from "node:assert/strict";
import { test } from "node:test";
import { mayRecordRepayment } from "./expense-group.service";
import { maxRepaymentCents, type MemberBalance } from "./group-balances";

const balance = (adminUserId: bigint, pendingCents: number): MemberBalance => ({
  adminUserId,
  name: String(adminUserId),
  paidCents: 0,
  shareCents: 0,
  sentCents: 0,
  receivedCents: 0,
  pendingCents,
});

test("only the two people in a repayment, or a super admin, can record it", () => {
  assert.equal(mayRecordRepayment(1n, 2n, { id: 1n, isSuperAdmin: false }), true);
  assert.equal(mayRecordRepayment(1n, 2n, { id: 2n, isSuperAdmin: false }), true);
  assert.equal(mayRecordRepayment(1n, 2n, { id: 3n, isSuperAdmin: false }), false);
  assert.equal(mayRecordRepayment(1n, 2n, { id: 3n, isSuperAdmin: true }), true);
});

test("a repayment is capped by what the payer owes and the other is owed", () => {
  const balances = [balance(1n, -500), balance(2n, 300), balance(3n, 200)];
  assert.equal(maxRepaymentCents(balances, 1n, 2n), 300);
  assert.equal(maxRepaymentCents(balances, 1n, 3n), 200);
});

test("nothing can be repaid the wrong way round, or by someone with no balance", () => {
  const balances = [balance(1n, -500), balance(2n, 500)];
  assert.equal(maxRepaymentCents(balances, 2n, 1n), 0);
  assert.equal(maxRepaymentCents(balances, 9n, 2n), 0);
});
