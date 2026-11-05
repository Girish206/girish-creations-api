import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeGroup, type PersonRef } from "./group-balances";

const asha: PersonRef = { id: 1n, name: "Asha", email: null };
const ravi: PersonRef = { id: 2n, name: "Ravi", email: null };
const meena: PersonRef = { id: 3n, name: null, email: "meena@example.com" };

const split = (amount: string, paidBy: PersonRef, shares: [PersonRef, string][]) => ({
  amount,
  paidBy,
  splitParticipants: shares.map(([adminUser, shareAmount]) => ({ adminUser, shareAmount })),
});

test("a split expense leaves the others owing the payer", () => {
  const { balances, totalCents, expenseCount } = summarizeGroup(
    [split("100.00", asha, [[asha, "33.34"], [ravi, "33.33"], [meena, "33.33"]])],
    [],
  );
  assert.equal(totalCents, 10000);
  assert.equal(expenseCount, 1);
  assert.deepEqual(
    balances.map((b) => [b.name, b.pendingCents]),
    [["Asha", 6666], ["meena@example.com", -3333], ["Ravi", -3333]],
  );
  assert.equal(balances.reduce((sum, b) => sum + b.pendingCents, 0), 0);
});

test("an unsplit expense doesn't change anyone's balance", () => {
  const { balances } = summarizeGroup([split("50.00", ravi, [])], []);
  assert.equal(balances[0].paidCents, 5000);
  assert.equal(balances[0].shareCents, 5000);
  assert.equal(balances[0].pendingCents, 0);
});

test("a recorded repayment reduces what's pending on both sides", () => {
  const { balances } = summarizeGroup(
    [split("100.00", asha, [[asha, "50.00"], [ravi, "50.00"]])],
    [{ amount: "20.00", fromAdminUser: ravi, toAdminUser: asha }],
  );
  assert.deepEqual(
    balances.map((b) => [b.name, b.pendingCents, b.sentCents, b.receivedCents]),
    [["Asha", 3000, 0, 2000], ["Ravi", -3000, 2000, 0]],
  );
});
