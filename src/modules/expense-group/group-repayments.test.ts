import assert from "node:assert/strict";
import { test } from "node:test";
import { mayRecordRepayment } from "./expense-group.service";
import { maxRepaymentCents, suggestTransfers, type MemberBalance } from "./group-balances";

const balance = (adminUserId: bigint, pendingCents: number): MemberBalance => ({
  adminUserId,
  name: String(adminUserId),
  paidCents: 0,
  shareCents: 0,
  sentCents: 0,
  receivedCents: 0,
  pendingCents,
});

test("only whoever gets the money, or a super admin, can mark a repayment", () => {
  const receiver = 2n;
  assert.equal(mayRecordRepayment(receiver, { id: 2n, isSuperAdmin: false }), true);
  assert.equal(mayRecordRepayment(receiver, { id: 1n, isSuperAdmin: false }), false);
  assert.equal(mayRecordRepayment(receiver, { id: 3n, isSuperAdmin: false }), false);
  assert.equal(mayRecordRepayment(receiver, { id: 3n, isSuperAdmin: true }), true);
});

// Deeksha paid 2,000, Girish 1,000 and Kiran 400 for four people at 850 each.
const DEEKSHA = 1n;
const GIRISH = 2n;
const KIRAN = 3n;
const MAHESH = 4n;
const person = (adminUserId: bigint, paidCents: number, shareCents: number): MemberBalance => ({
  adminUserId,
  name: String(adminUserId),
  paidCents,
  shareCents,
  sentCents: 0,
  receivedCents: 0,
  pendingCents: paidCents - shareCents,
});
const trip = () => [
  person(DEEKSHA, 200000, 85000),
  person(GIRISH, 100000, 85000),
  person(KIRAN, 40000, 85000),
  person(MAHESH, 0, 85000),
];
const repay = (balances: MemberBalance[], from: bigint, to: bigint, cents: number) =>
  balances.map((balance) => {
    if (balance.adminUserId === from) {
      return { ...balance, sentCents: balance.sentCents + cents, pendingCents: balance.pendingCents + cents };
    }
    if (balance.adminUserId === to) {
      return { ...balance, receivedCents: balance.receivedCents + cents, pendingCents: balance.pendingCents - cents };
    }
    return balance;
  });
const rows = (balances: MemberBalance[]) =>
  suggestTransfers(balances).map((row) => [row.fromAdminUserId, row.toAdminUserId, row.amountCents]);

test("one person is cleared, then what's left goes to the next", () => {
  assert.deepEqual(rows(trip()), [
    [MAHESH, DEEKSHA, 85000],
    [KIRAN, DEEKSHA, 30000],
    [KIRAN, GIRISH, 15000],
  ]);
});

test("a part payment only lowers its own row, down to everyone being settled", () => {
  let balances = repay(trip(), MAHESH, DEEKSHA, 50000);
  assert.deepEqual(rows(balances), [
    [MAHESH, DEEKSHA, 35000],
    [KIRAN, DEEKSHA, 30000],
    [KIRAN, GIRISH, 15000],
  ]);
  balances = repay(balances, MAHESH, DEEKSHA, 35000);
  assert.deepEqual(rows(balances), [
    [KIRAN, DEEKSHA, 30000],
    [KIRAN, GIRISH, 15000],
  ]);
  balances = repay(balances, KIRAN, DEEKSHA, 30000);
  assert.deepEqual(rows(balances), [[KIRAN, GIRISH, 15000]]);
  balances = repay(balances, KIRAN, GIRISH, 10000);
  assert.deepEqual(rows(balances), [[KIRAN, GIRISH, 5000]]);
  assert.deepEqual(rows(repay(balances, KIRAN, GIRISH, 5000)), []);
});

test("the rows stay the same whatever order people pay in", () => {
  assert.deepEqual(rows(repay(trip(), KIRAN, GIRISH, 10000)), [
    [MAHESH, DEEKSHA, 85000],
    [KIRAN, DEEKSHA, 30000],
    [KIRAN, GIRISH, 5000],
  ]);
  assert.deepEqual(rows(repay(trip(), KIRAN, DEEKSHA, 20000)), [
    [MAHESH, DEEKSHA, 85000],
    [KIRAN, DEEKSHA, 10000],
    [KIRAN, GIRISH, 15000],
  ]);
});

test("people owing the same are put in the same order every time", () => {
  const even = [person(9n, 90000, 30000), person(5n, 0, 30000), person(2n, 0, 30000)];
  assert.deepEqual(rows(even), [
    [2n, 9n, 30000],
    [5n, 9n, 30000],
  ]);
  assert.deepEqual(rows([...even].reverse()), rows(even));
});

test("a repayment can't go beyond its row, or between people with no row", () => {
  assert.equal(maxRepaymentCents(trip(), KIRAN, DEEKSHA), 30000);
  assert.equal(maxRepaymentCents(repay(trip(), KIRAN, DEEKSHA, 10000), KIRAN, DEEKSHA), 20000);
  assert.equal(maxRepaymentCents(trip(), MAHESH, GIRISH), 0);
});

test("a payer with two rows can repay each of them up to its amount", () => {
  const balances = [balance(1n, -500), balance(2n, 300), balance(3n, 200)];
  assert.equal(maxRepaymentCents(balances, 1n, 2n), 300);
  assert.equal(maxRepaymentCents(balances, 1n, 3n), 200);
});

test("nothing can be repaid the wrong way round, or by someone with no balance", () => {
  const balances = [balance(1n, -500), balance(2n, 500)];
  assert.equal(maxRepaymentCents(balances, 2n, 1n), 0);
  assert.equal(maxRepaymentCents(balances, 9n, 2n), 0);
});
