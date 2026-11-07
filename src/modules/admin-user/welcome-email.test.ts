import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWelcomeEmail } from "./welcome-email";

const member = {
  email: "ravi@example.com",
  mobile: null,
  name: "Ravi Kumar",
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: true,
  hasSavingsAccess: false,
};

test("it comes from Girish Creations", () => {
  const email = buildWelcomeEmail(member);
  assert.equal(email.fromName, "Girish Creations");
  assert.equal(email.subject, "Welcome to Girish Creations");
});

test("it greets them and lists only what they can use", () => {
  const email = buildWelcomeEmail(member);
  assert.deepEqual(email.to, [{ address: "ravi@example.com", name: "Ravi Kumar" }]);
  assert.ok(email.textBody?.startsWith("Hi Ravi,"));
  assert.ok(email.htmlBody?.includes("<strong style=\"color: #111827\">Expenses</strong>"));
  assert.ok(!email.htmlBody?.includes("Savings"));
  assert.ok(email.textBody?.includes("- Expenses:"));
  assert.ok(!email.textBody?.includes("- Savings:"));
  assert.ok(!email.textBody?.includes("- Portfolio:"));
});

test("it carries the logo its header refers to", () => {
  const email = buildWelcomeEmail(member);
  const cid = /src="cid:([^"]+)"/.exec(email.htmlBody ?? "")?.[1];
  assert.equal(email.inlineImages?.[0].cid, cid);
  assert.equal(email.inlineImages?.[0].mimeType, "image/png");
});

test("the replies aren't redirected, so they reach the shared inbox", () => {
  assert.equal(buildWelcomeEmail(member).replyTo, undefined);
});

test("the mobile and sign-in button appear only when there is one", () => {
  const without = buildWelcomeEmail(member);
  assert.ok(!without.textBody?.includes("Or mobile"));
  assert.ok(!without.htmlBody?.includes("Sign in to"));

  const withBoth = buildWelcomeEmail({ ...member, mobile: "9876543210" }, "https://example.com/admin/login");
  assert.ok(withBoth.textBody?.includes("Or mobile: 9876543210"));
  assert.ok(withBoth.textBody?.includes("Sign in to Girish Creations: https://example.com/admin/login"));
  assert.ok(withBoth.htmlBody?.includes('href="https://example.com/admin/login"'));
});

test("a name can't inject markup", () => {
  const email = buildWelcomeEmail({ ...member, name: `<img src=x onerror="alert(1)">` });
  assert.ok(!email.htmlBody?.includes("<img src=x"));
});
