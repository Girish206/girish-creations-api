import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWelcomeEmail, welcomeAppFor } from "./welcome-email";

const member = {
  email: "ravi@example.com",
  mobile: null,
  name: "Ravi Kumar",
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: true,
  hasSavingsAccess: false,
  hasCricketAccess: false,
};
const player = { ...member, hasExpensesAccess: false, hasCricketAccess: true };

test("a cricket-only player hears from RunMitra, anyone else from Girish Creations", () => {
  assert.equal(welcomeAppFor(player), "cricket");
  assert.equal(welcomeAppFor(member), "admin");
  assert.equal(welcomeAppFor({ ...player, hasSavingsAccess: true }), "admin");

  const email = buildWelcomeEmail(player);
  assert.equal(email.fromName, "RunMitra");
  assert.equal(email.subject, "Welcome to RunMitra");
  assert.ok(!email.htmlBody?.includes("Girish"));
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

test("it carries the logo its header refers to, for the app it's from", () => {
  const emails = [buildWelcomeEmail(member), buildWelcomeEmail(player)];
  for (const email of emails) {
    const cid = /src="cid:([^"]+)"/.exec(email.htmlBody ?? "")?.[1];
    assert.equal(email.inlineImages?.[0].cid, cid);
    assert.equal(email.inlineImages?.[0].mimeType, "image/png");
  }
  assert.notEqual(emails[0].inlineImages?.[0].content, emails[1].inlineImages?.[0].content);
});

test("the replies aren't redirected, so they reach the shared inbox", () => {
  assert.equal(buildWelcomeEmail(member).replyTo, undefined);
});

const appUrls = { admin: "https://example.com/admin", cricket: "https://example.org" };

test("it links only to the apps they can use", () => {
  const hasLink = (account: typeof member, url: string) =>
    buildWelcomeEmail(account, appUrls).htmlBody?.includes(`href="${url}"`) &&
    buildWelcomeEmail(account, appUrls).textBody?.includes(url);

  assert.equal(hasLink(member, appUrls.admin), true);
  assert.equal(hasLink(member, appUrls.cricket), false);
  assert.equal(hasLink(player, appUrls.cricket), true);
  assert.equal(hasLink(player, appUrls.admin), false);

  const both = { ...member, hasCricketAccess: true };
  assert.equal(hasLink(both, appUrls.admin), true);
  assert.equal(hasLink(both, appUrls.cricket), true);
  assert.ok(buildWelcomeEmail(both, appUrls).textBody?.includes("Sign in to RunMitra: https://example.org"));
});

test("the mobile and sign-in button appear only when there is one", () => {
  const without = buildWelcomeEmail(member);
  assert.ok(!without.textBody?.includes("Or mobile"));
  assert.ok(!without.htmlBody?.includes("Sign in to"));

  const withBoth = buildWelcomeEmail({ ...member, mobile: "9876543210" }, { admin: "https://example.com/admin/login" });
  assert.ok(withBoth.textBody?.includes("Or mobile: 9876543210"));
  assert.ok(withBoth.htmlBody?.includes('href="https://example.com/admin/login"'));
});

test("a name can't inject markup", () => {
  const email = buildWelcomeEmail({ ...member, name: `<img src=x onerror="alert(1)">` });
  assert.ok(!email.htmlBody?.includes("<img src=x"));
});
