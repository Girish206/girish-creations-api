import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContactEmail } from "./contact-email";

const owner = { address: "owner@example.com", name: "Owner" };
const contact = { id: 7n, name: "Visitor", email: "visitor@example.com", subject: "Hello", message: "Nice site" };

test("goes to the owner, and replies go to the visitor", () => {
  const email = buildContactEmail(contact, owner);
  assert.deepEqual(email.to, [owner]);
  assert.deepEqual(email.replyTo, { address: "visitor@example.com", name: "Visitor" });
  assert.equal(email.subject, "New portfolio message: Hello");
  assert.equal(email.clientReference, "contact-7");
});

test("a visitor can't inject markup into the HTML", () => {
  const email = buildContactEmail(
    {
      ...contact,
      name: `<img src=x onerror="alert(1)">`,
      subject: "<script>bad()</script>",
      message: `<a href="https://evil.example">Click</a>`,
    },
    owner,
  );
  for (const raw of ["<img src=x", "<script", '<a href="https://evil']) {
    assert.ok(!email.htmlBody?.includes(raw), raw);
  }
  assert.ok(email.htmlBody?.includes("&lt;script&gt;"));
});

test("line breaks can't reach the subject line", () => {
  const email = buildContactEmail({ ...contact, subject: "Hi\r\nBcc: someone@example.com" }, owner);
  assert.equal(email.subject, "New portfolio message: Hi Bcc: someone@example.com");
});

test("the message keeps its line breaks", () => {
  const email = buildContactEmail({ ...contact, message: "Line one\nLine two" }, owner);
  assert.ok(email.textBody?.includes("Line one\nLine two"));
  assert.ok(email.htmlBody?.includes("Line one<br>Line two"));
});

test("it's plain, with no logo or card", () => {
  const email = buildContactEmail(contact, owner);
  assert.equal(email.inlineImages, undefined);
  assert.ok(!email.htmlBody?.includes("cid:"));
  assert.ok(!email.htmlBody?.includes("gradient"));
});

test("it's from Girish Creations, and the reply link addresses the visitor", () => {
  const email = buildContactEmail(contact, owner);
  assert.equal(email.fromName, "Girish Creations");
  assert.ok(email.htmlBody?.includes('href="mailto:visitor@example.com?subject=Re%3A%20Hello"'));
});

test("a visitor can't break out of the reply link", () => {
  const email = buildContactEmail({ ...contact, subject: `"><script>x</script>'` }, owner);
  assert.ok(!email.htmlBody?.includes("<script"));
});
