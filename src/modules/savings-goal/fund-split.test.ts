import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeGroup } from "../expense-group/group-balances";
import { computeFundSplit, isSharedFund, type PersonRef } from "./fund-split";

const asha: PersonRef = { id: 1n, name: "Asha", email: null };
const ravi: PersonRef = { id: 2n, name: "Ravi", email: null };
const meena: PersonRef = { id: 3n, name: null, email: "meena@example.com" };
const people = [asha, ravi, meena];
const putIn = (person: PersonRef, amount: string) => ({ amount, contributedBy: person });

// Bandihole: everyone puts in 3,000 and 7,500 is spent from the fund.
test("what's left in a fund goes back by share", () => {
  const rows = computeFundSplit(
    people,
    people.map((person) => putIn(person, "3000.00")),
    [{ amount: "7500.00", splitParticipants: [] }],
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.putInCents, row.shareCents, row.balanceCents]),
    [
      ["Asha", 300000, 250000, 50000],
      ["Ravi", 300000, 250000, 50000],
      ["meena@example.com", 300000, 250000, 50000],
    ],
  );
});

test("an expense split between some people only counts for them", () => {
  const rows = computeFundSplit(
    people,
    people.map((person) => putIn(person, "1000.00")),
    [
      { amount: "900.00", splitParticipants: [] },
      { amount: "400.00", splitParticipants: [{ shareAmount: "200.00", adminUser: asha }, { shareAmount: "200.00", adminUser: ravi }] },
    ],
  );
  const balance = Object.fromEntries(rows.map((row) => [row.name, row.balanceCents]));
  assert.deepEqual(balance, { Asha: 50000, Ravi: 50000, "meena@example.com": 70000 });
});

test("uneven amounts in and a fund that ran short", () => {
  const rows = computeFundSplit(
    people,
    [putIn(asha, "2000.00"), putIn(ravi, "1000.00")],
    [{ amount: "3600.00", splitParticipants: [] }],
  );
  const balance = Object.fromEntries(rows.map((row) => [row.name, row.balanceCents]));
  // Shares of 1,200 each: Asha gets 800 back, Ravi tops up 200, Meena 1,200.
  assert.deepEqual(balance, { Asha: 80000, Ravi: -20000, "meena@example.com": -120000 });
});

test("leftover paise from an even share go to the first people", () => {
  const rows = computeFundSplit(people, [], [{ amount: "100.00", splitParticipants: [] }]);
  assert.deepEqual(
    rows.map((row) => row.shareCents),
    [3334, 3333, 3333],
  );
});

test("only a goal of the fund kind is a shared fund", () => {
  assert.equal(isSharedFund({ kind: "fund" }), true);
  assert.equal(isSharedFund({ kind: null }), false);
  assert.equal(isSharedFund(null), false);
});

test("in a group, an expense paid from a shared fund counts in the total, not the balances", () => {
  const split = [
    { shareAmount: "300.00", adminUser: asha },
    { shareAmount: "300.00", adminUser: ravi },
  ];
  const { balances, totalCents } = summarizeGroup(
    [
      { amount: "600.00", paidBy: asha, splitParticipants: split, savingsGoal: { kind: "fund" } },
      { amount: "600.00", paidBy: ravi, splitParticipants: split, savingsGoal: null },
    ],
    [],
  );
  assert.equal(totalCents, 120000);
  const pending = Object.fromEntries(balances.map((b) => [b.name, b.pendingCents]));
  // Only Ravi's own payment is owed: Asha owes him her 300.
  assert.deepEqual(pending, { Ravi: 30000, Asha: -30000 });
});
