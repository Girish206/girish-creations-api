import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCodeEmail, buildPasswordChangedEmail, codeMatches, generateCode, hashCode, maskEmail } from "./auth-code";

const secret = "test-secret";

test("codes are always six digits, including leading zeros", () => {
  for (let i = 0; i < 2000; i++) assert.match(generateCode(), /^\d{6}$/);
});

test("a code matches its own hash", () => {
  const stored = hashCode("123456", 1n, "login", secret);
  assert.equal(codeMatches("123456", stored, 1n, "login", secret), true);
  assert.equal(codeMatches("654321", stored, 1n, "login", secret), false);
});

test("the stored hash doesn't contain the code", () => {
  assert.ok(!hashCode("123456", 1n, "login", secret).includes("123456"));
});

test("a code can't be used for another account, purpose or secret", () => {
  const stored = hashCode("123456", 1n, "login", secret);
  assert.equal(codeMatches("123456", stored, 2n, "login", secret), false);
  assert.equal(codeMatches("123456", stored, 1n, "reset", secret), false);
  assert.equal(codeMatches("123456", stored, 1n, "login", "other"), false);
});

test("emails are masked but recognisable", () => {
  assert.equal(maskEmail("girish@gmail.com"), "g***@gmail.com");
  assert.equal(maskEmail("a@b.com"), "a***@b.com");
});

test("a code email carries the code, but isn't logged by reference", () => {
  const email = buildCodeEmail({ address: "a@b.com" }, "123456", "reset");
  assert.equal(email.subject, "Reset your Pocket password");
  assert.ok(email.textBody?.includes("123456"));
  assert.ok(email.htmlBody?.includes("123456"));
  assert.ok(!email.subject.includes("123456"));
  assert.ok(!email.clientReference?.includes("123456"));
});

test("a sign-in code and a password reset say different things", () => {
  const login = buildCodeEmail({ address: "a@b.com" }, "123456", "login");
  assert.equal(login.subject, "Your Pocket sign-in code");
  assert.ok(login.textBody?.includes("sign in to Pocket"));
  assert.ok(login.textBody?.includes("Your code: 123456"));
});

test("a code email is from Pocket, in its colours", () => {
  const email = buildCodeEmail({ address: "a@b.com" }, "123456", "login");
  assert.equal(email.fromName, "Pocket");
  assert.ok(email.htmlBody?.includes("#9e6207"));
});

test("these emails carry the Pocket logo their header shows", () => {
  const emails = [
    buildCodeEmail({ address: "a@b.com" }, "123456", "login"),
    buildCodeEmail({ address: "a@b.com" }, "123456", "reset"),
    buildPasswordChangedEmail({ address: "a@b.com" }),
  ];
  for (const email of emails) {
    const cid = /<img src="cid:([^"]+)"[^>]*alt="[^"]* logo"/.exec(email.htmlBody ?? "")?.[1];
    assert.ok(cid);
    assert.equal(email.inlineImages?.[0].cid, cid);
    assert.equal(email.inlineImages?.[0].mimeType, "image/png");
    assert.ok(email.htmlBody?.includes("Pocket logo"));
  }
});

test("the code stays out of the preview line inboxes show", () => {
  const html = buildCodeEmail({ address: "a@b.com" }, "123456", "login").htmlBody ?? "";
  const preheader = /<div style="display: none[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(preheader.length > 0);
  assert.ok(!preheader.includes("123456"));
  assert.ok(html.includes(">123456<"));
});

test("greets people by first name, and copes without one", () => {
  assert.ok(buildCodeEmail({ address: "a@b.com", name: "Asha Rao" }, "123456", "login").textBody?.startsWith("Hi Asha,"));
  assert.ok(buildCodeEmail({ address: "a@b.com" }, "123456", "login").textBody?.startsWith("Hi,"));
});

test("a name can't inject markup", () => {
  const html = buildCodeEmail({ address: "a@b.com", name: "<img src=x>" }, "123456", "login").htmlBody ?? "";
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("the password-changed notice says when, in Indian time, and what to do", () => {
  const email = buildPasswordChangedEmail({ address: "a@b.com" }, new Date("2026-11-05T18:30:00Z"));
  assert.ok(email.textBody?.includes("6 Nov 2026"));
  assert.ok(email.textBody?.includes("IST"));
  assert.ok(email.textBody?.includes("Wasn't you?"));
});

test("the sign-up email asks to verify the address and carries the code", () => {
  const email = buildCodeEmail({ address: "new@example.com", name: "Asha Rao" }, "042517", "register");
  const text = email.textBody ?? "";
  assert.match(email.subject, /^Verify your email for /);
  assert.ok(text.includes("042517"));
  assert.ok(text.startsWith("Hi Asha,"));
  assert.match(text, /no account is created without the code/);
});

test("a sign-up code can't be used as a sign-in code", () => {
  const stored = hashCode("123456", 7n, "register", secret);
  assert.equal(codeMatches("123456", stored, 7n, "register", secret), true);
  assert.equal(codeMatches("123456", stored, 7n, "login", secret), false);
});
