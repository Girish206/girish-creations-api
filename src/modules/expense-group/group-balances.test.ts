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

test("a linked fund settles together with the trip's own expenses", () => {
  // Asha keeps the fund. Everyone put in 1000; 2400 was spent from it, shared
  // equally (800 each), so 600 is left with Asha. Ravi also paid a 300 dinner
  // himself, split with Meena.
  const fund = {
    holder: asha,
    split: [
      { adminUserId: 1n, name: "Asha", putInCents: 100000, shareCents: 80000, balanceCents: 20000 },
      { adminUserId: 2n, name: "Ravi", putInCents: 100000, shareCents: 80000, balanceCents: 20000 },
      { adminUserId: 3n, name: "meena@example.com", putInCents: 100000, shareCents: 80000, balanceCents: 20000 },
    ],
  };
  const { balances } = summarizeGroup(
    [
      split("300.00", ravi, [[ravi, "150.00"], [meena, "150.00"]]),
      // Paid from the fund: covered by the fund's split, not by Asha.
      { ...split("2400.00", asha, []), savingsGoal: { kind: "fund" } },
    ],
    [],
    fund,
  );
  const pending = Object.fromEntries(balances.map((b) => [b.name, b.pendingCents]));
  // Asha holds 600 but is owed 200 of it back: she pays out 400.
  assert.equal(pending["Asha"], -40000);
  // Ravi: 200 back from the fund, plus 150 from Meena for dinner.
  assert.equal(pending["Ravi"], 35000);
  // Meena: 200 back from the fund, less the 150 she owes Ravi.
  assert.equal(pending["meena@example.com"], 5000);
  assert.equal(balances.reduce((sum, b) => sum + b.pendingCents, 0), 0);
});

test("an overspent fund leaves its keeper owed the difference", () => {
  const fund = {
    holder: asha,
    split: [
      { adminUserId: 1n, name: "Asha", putInCents: 50000, shareCents: 60000, balanceCents: -10000 },
      { adminUserId: 2n, name: "Ravi", putInCents: 50000, shareCents: 60000, balanceCents: -10000 },
    ],
  };
  const { balances } = summarizeGroup([], [], fund);
  const asha_ = balances.find((b) => b.name === "Asha")!;
  assert.equal(asha_.fundHeldCents, -20000);
  assert.equal(asha_.pendingCents, 10000);
  assert.equal(balances.find((b) => b.name === "Ravi")!.pendingCents, -10000);
});
