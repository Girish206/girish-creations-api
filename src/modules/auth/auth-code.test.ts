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

test("a code email names the right app, and isn't logged by reference", () => {
  const email = buildCodeEmail({ address: "a@b.com" }, "123456", "reset", "cricket");
  assert.equal(email.subject, "Reset your RunMitra password");
  assert.ok(email.textBody?.includes("123456"));
  assert.ok(email.htmlBody?.includes("123456"));
  assert.ok(!email.subject.includes("123456"));
  assert.ok(!email.clientReference?.includes("123456"));
});

test("a sign-in code and a password reset say different things", () => {
  const login = buildCodeEmail({ address: "a@b.com" }, "123456", "login", "admin");
  assert.equal(login.subject, "Your Girish Creations sign-in code");
  assert.ok(login.textBody?.includes("sign in to Girish Creations"));
  assert.ok(login.textBody?.includes("Your code: 123456"));
});

test("each app's email looks and reads like that app", () => {
  const runmitra = buildCodeEmail({ address: "a@b.com" }, "123456", "login", "cricket");
  const girish = buildCodeEmail({ address: "a@b.com" }, "123456", "login", "admin");
  assert.equal(runmitra.fromName, "RunMitra");
  assert.equal(girish.fromName, "Girish Creations");
  assert.ok(runmitra.htmlBody?.includes("#7a2420") && !runmitra.htmlBody?.includes("#4f46e5"));
  assert.ok(girish.htmlBody?.includes("#4f46e5") && !girish.htmlBody?.includes("#7a2420"));
  assert.ok(!runmitra.htmlBody?.includes("Girish"));
});

test("these emails are plain: no logo, header or card", () => {
  const emails = [
    buildCodeEmail({ address: "a@b.com" }, "123456", "login", "cricket"),
    buildCodeEmail({ address: "a@b.com" }, "123456", "reset", "admin"),
    buildPasswordChangedEmail({ address: "a@b.com" }, "admin"),
  ];
  for (const email of emails) {
    assert.equal(email.inlineImages, undefined);
    assert.ok(!email.htmlBody?.includes("cid:"));
    assert.ok(!email.htmlBody?.includes("gradient"));
    assert.ok(!email.htmlBody?.includes("border-radius"));
  }
});

test("the code stays out of the preview line inboxes show", () => {
  const html = buildCodeEmail({ address: "a@b.com" }, "123456", "login", "admin").htmlBody ?? "";
  const preheader = /<div style="display: none[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(preheader.length > 0);
  assert.ok(!preheader.includes("123456"));
  assert.ok(html.includes(">123456<"));
});

test("greets people by first name, and copes without one", () => {
  assert.ok(buildCodeEmail({ address: "a@b.com", name: "Asha Rao" }, "123456", "login", "admin").textBody?.startsWith("Hi Asha,"));
  assert.ok(buildCodeEmail({ address: "a@b.com" }, "123456", "login", "admin").textBody?.startsWith("Hi,"));
});

test("a name can't inject markup", () => {
  const html = buildCodeEmail({ address: "a@b.com", name: "<img src=x>" }, "123456", "login", "admin").htmlBody ?? "";
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("the password-changed notice says when, in Indian time, and what to do", () => {
  const email = buildPasswordChangedEmail({ address: "a@b.com" }, "cricket", new Date("2026-11-05T18:30:00Z"));
  assert.ok(email.textBody?.includes("6 Nov 2026"));
  assert.ok(email.textBody?.includes("IST"));
  assert.ok(email.textBody?.includes("Wasn't you?"));
  assert.ok(email.textBody?.includes("Girish Creations"), "mentions the other app sharing the password");
});
