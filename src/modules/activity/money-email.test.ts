import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNoticeEmail } from "./money-email";
import { formatAmount } from "./activity.service";

const notice = {
  subject: "Asha split an expense with you",
  lines: ["Asha added you to <Dinner>."],
  details: [{ label: "Your share", value: "₹300" }],
  footer: "Because.",
  reference: "test",
};

test("a notice greets by first name and escapes what people typed", () => {
  const email = buildNoticeEmail(notice, { id: 1n, email: "r@x.in", name: "Ravi Kumar", canOpenApp: false }, "https://app");
  assert.match(email.textBody!, /^Hi Ravi,/);
  assert.match(email.htmlBody!, /&lt;Dinner&gt;/);
  assert.doesNotMatch(email.textBody!, /https:\/\/app/);
});

test("only people who can open the app get the link", () => {
  const email = buildNoticeEmail(notice, { id: 1n, email: "r@x.in", name: null, canOpenApp: true }, "https://app");
  assert.match(email.textBody!, /Open Pocket: https:\/\/app/);
});

test("amounts read as the app shows them", () => {
  assert.equal(formatAmount("1200"), "₹1,200");
  assert.equal(formatAmount("1200.5"), "₹1,200.50");
});
