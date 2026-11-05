import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestTransfers } from "./group-balances";
import { buildSplitEmail, splitEmailAudience } from "./group-split-email";
import { splitEmailBlocker } from "./expense-group.service";

const balance = (adminUserId: bigint, name: string, paidCents: number, shareCents: number, sentCents = 0, receivedCents = 0) => ({
  adminUserId,
  name,
  paidCents,
  shareCents,
  sentCents,
  receivedCents,
  pendingCents: paidCents - shareCents + sentCents - receivedCents,
});

const balances = [balance(1n, "Ravi Kumar", 120000, 40000), balance(2n, "Asha", 0, 40000), balance(3n, "Vik", 0, 40000)];
const group = { id: 7n, name: "Goa Trip", totalCents: 120000, balances, transfers: suggestTransfers(balances) };
const asha = { id: 2n, email: "asha@example.com", name: "Asha", canOpenApp: true };
const ravi = { id: 1n, email: "ravi@example.com", name: "Ravi Kumar", canOpenApp: true };

test("it gives the group, the total and the per head amount", () => {
  const email = buildSplitEmail(group, asha, "Ravi Kumar");
  assert.equal(email.subject, "Split-up for Goa Trip");
  assert.deepEqual(email.to, [{ address: "asha@example.com", name: "Asha" }]);
  assert.ok(email.textBody?.startsWith("Hi Asha,"));
  assert.ok(email.textBody?.includes("Ravi Kumar shared the group's split-up."));
  assert.ok(email.textBody?.includes("Group: Goa Trip"));
  assert.ok(email.textBody?.includes("Total expense: ₹1,200"));
  assert.ok(email.textBody?.includes("Per head: ₹400"));
});

test("it shows who paid how much, their final share and their balance", () => {
  const { textBody, htmlBody } = buildSplitEmail(group, asha, "Ravi Kumar");
  assert.ok(textBody?.includes("Ravi Kumar: Paid ₹1,200, Final share ₹400, Gets ₹800"));
  assert.ok(textBody?.includes("Asha: Paid ₹0, Final share ₹400, Owes ₹400"));
  for (const heading of ["Name", "Paid", "Final share", "Balance"]) assert.ok(htmlBody?.includes(`>${heading}</th>`));
});

test("it says who pays whom", () => {
  const { textBody, htmlBody } = buildSplitEmail(group, asha, "Ravi Kumar");
  assert.ok(textBody?.includes("Who pays whom:\nAsha pays Ravi Kumar ₹400\nVik pays Ravi Kumar ₹400"));
  for (const heading of ["Pays", "Receives", "Amount"]) assert.ok(htmlBody?.includes(`>${heading}</th>`));
});

test("a settled group says so, with no one left to pay", () => {
  const square = [balance(1n, "Ravi", 500, 500)];
  const { textBody } = buildSplitEmail({ ...group, balances: square, transfers: [] }, ravi, "Ravi");
  assert.ok(textBody?.includes("Everyone is settled."));
  assert.ok(!textBody?.includes("Who pays whom"));
});

test("repayments are shown, so the balances add up", () => {
  const repaid = [balance(1n, "Deeksha", 145700, 36425, 0, 36425), balance(2n, "Girish", 0, 36425, 36425), balance(3n, "Kiran", 0, 36425), balance(4n, "Mahesh", 0, 36425)];
  const { textBody } = buildSplitEmail(
    { ...group, totalCents: 145700, balances: repaid, transfers: suggestTransfers(repaid) },
    asha,
    "Deeksha",
  );
  assert.ok(textBody?.includes("Per head: ₹364.25"));
  assert.ok(textBody?.includes("Repaid so far: ₹364.25"));
  assert.ok(textBody?.includes("Deeksha: Paid ₹1,457, Final share ₹364.25, Gets ₹728.50"));
  assert.ok(textBody?.includes("Girish: Paid ₹0, Final share ₹364.25, Settled"));
  assert.ok(!buildSplitEmail(group, asha, "Ravi").textBody?.includes("Repaid so far"));
});

test("it has no logo or header card", () => {
  const email = buildSplitEmail(group, asha, "Ravi Kumar");
  assert.equal(email.inlineImages, undefined);
  assert.ok(!email.htmlBody?.includes("cid:"));
  assert.ok(!email.htmlBody?.includes("gradient"));
});

test("whoever sent it isn't told someone shared it", () => {
  const { textBody } = buildSplitEmail(group, ravi, "Ravi Kumar");
  assert.ok(textBody?.includes("Here is the group's split-up."));
});

test("everyone active with an address gets it, and those without are named", () => {
  const account = { id: 2n, email: "a@example.com", name: "Asha", isActive: true, passwordHash: "hash", hasExpensesAccess: true };
  const { recipients, noEmail } = splitEmailAudience([
    account,
    { ...account, id: 3n, email: null, name: "Vik" },
    { ...account, id: 4n, email: "gone@example.com", isActive: false },
    { ...account, id: 5n, email: "guest@example.com", passwordHash: null },
  ]);
  assert.deepEqual(recipients.map((person) => [person.id, person.canOpenApp]), [
    [2n, true],
    [5n, false],
  ]);
  assert.deepEqual(noEmail, ["Vik"]);
});

test("only someone who can open the Money Hub is offered a link to it", () => {
  const url = "https://example.com/admin";
  assert.ok(buildSplitEmail(group, asha, "Ravi", url).htmlBody?.includes(`href="${url}"`));
  const guest = buildSplitEmail(group, { ...asha, canOpenApp: false }, "Ravi", url);
  assert.ok(!guest.htmlBody?.includes(url));
  assert.ok(!guest.textBody?.includes(url));
});

test("a balance named by an address doesn't give the address away", () => {
  const named = [balance(1n, "ravi@example.com", 1000, 500), balance(2n, "Asha", 0, 500)];
  const email = buildSplitEmail({ ...group, balances: named, transfers: suggestTransfers(named) }, asha, "ravi@example.com");
  assert.ok(email.textBody?.includes("Asha pays r***@example.com ₹5"));
  assert.ok(!email.textBody?.includes("ravi@example.com"));
  assert.ok(!email.htmlBody?.includes("ravi@example.com"));
  assert.ok(email.textBody?.includes("r***@example.com"));
});

test("what people typed can't inject markup or break the subject", () => {
  const email = buildSplitEmail(
    {
      ...group,
      name: "Goa\r\nBcc: x@example.com <b>",
      balances: [balance(1n, `<img src=x onerror="alert(1)">`, 500, 0), balance(2n, "Asha", 0, 500)],
      transfers: suggestTransfers([balance(1n, `<img src=x onerror="alert(1)">`, 500, 0), balance(2n, "Asha", 0, 500)]),
    },
    asha,
    "<i>Ravi</i>",
  );
  assert.ok(!email.htmlBody?.includes("<img src=x"));
  assert.ok(!email.htmlBody?.includes("<b>"));
  assert.ok(!email.htmlBody?.includes("<i>Ravi"));
  assert.ok(!/[\r\n]/.test(email.subject));
});

test("the split-up can be sent again, but not straight away, and not for an empty group", () => {
  const sentAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(splitEmailBlocker({ expenseCount: 2, splitEmailSentAt: null }), null);
  assert.match(splitEmailBlocker({ expenseCount: 0, splitEmailSentAt: null }) ?? "", /no expenses/);
  assert.match(
    splitEmailBlocker({ expenseCount: 2, splitEmailSentAt: sentAt }, sentAt.getTime() + 15_000) ?? "",
    /another in 45 seconds/,
  );
  assert.equal(splitEmailBlocker({ expenseCount: 2, splitEmailSentAt: sentAt }, sentAt.getTime() + 60_000), null);
});
