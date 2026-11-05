import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDirectTransfers, type PersonRef } from "./direct-balances";

const asha: PersonRef = { id: 1n, name: "Asha", email: null };
const ravi: PersonRef = { id: 2n, name: "Ravi", email: null };
const meena: PersonRef = { id: 3n, name: null, email: "meena@example.com" };

const paid = (paidBy: PersonRef, shares: [PersonRef, string][]) => ({
  paidBy,
  splitParticipants: shares.map(([adminUser, shareAmount]) => ({ adminUser, shareAmount })),
});
const summary = (rows: ReturnType<typeof computeDirectTransfers>) =>
  rows.map((t) => [t.fromName, t.toName, t.amountCents]);

test("each sharer owes the payer their own share, not the payer's", () => {
  assert.deepEqual(summary(computeDirectTransfers([paid(asha, [[asha, "300.00"], [ravi, "600.00"]])], [])), [
    ["Ravi", "Asha", 60000],
  ]);
});

test("two people's debts to each other net off", () => {
  const rows = computeDirectTransfers(
    [paid(asha, [[asha, "50.00"], [ravi, "50.00"]]), paid(ravi, [[ravi, "10.00"], [asha, "10.00"]])],
    [],
  );
  assert.deepEqual(summary(rows), [["Ravi", "Asha", 4000]]);
});

test("people who never split together are never told to pay each other", () => {
  const rows = computeDirectTransfers(
    [paid(asha, [[asha, "50.00"], [ravi, "50.00"]]), paid(meena, [[meena, "20.00"], [asha, "20.00"]])],
    [],
  );
  assert.deepEqual(summary(rows), [
    ["Ravi", "Asha", 5000],
    ["Asha", "meena@example.com", 2000],
  ]);
});

test("a partial repayment reduces the debt and a full one clears it", () => {
  const expenses = [paid(asha, [[asha, "50.00"], [ravi, "50.00"]])];
  assert.deepEqual(
    summary(computeDirectTransfers(expenses, [{ amount: "20.00", fromAdminUser: ravi, toAdminUser: asha }])),
    [["Ravi", "Asha", 3000]],
  );
  assert.deepEqual(computeDirectTransfers(expenses, [{ amount: "50.00", fromAdminUser: ravi, toAdminUser: asha }]), []);
});

test("an expense the payer covered for someone else is owed in full", () => {
  assert.deepEqual(summary(computeDirectTransfers([paid(asha, [[ravi, "100.00"]])], [])), [["Ravi", "Asha", 10000]]);
});

test("a repayment left behind after its expense is gone reverses the debt", () => {
  assert.deepEqual(summary(computeDirectTransfers([], [{ amount: "20.00", fromAdminUser: ravi, toAdminUser: asha }])), [
    ["Asha", "Ravi", 2000],
  ]);
});
