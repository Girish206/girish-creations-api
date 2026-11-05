import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { EmailError, isEmailEnabled, sendEmail } from "./email";

// A stand-in for ZeptoMail on localhost, so these go over real HTTP without
// ever sending anything.
let server: Server;
let lastRequest: { headers: IncomingMessage["headers"]; body: Record<string, unknown> } | null = null;
let reply: { status: number; body: string } = { status: 200, body: "{}" };

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      lastRequest = { headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(() => {
  server.close();
});

beforeEach(() => {
  lastRequest = null;
  reply = { status: 200, body: JSON.stringify({ message: "OK", request_id: "req-1", data: [] }) };
  process.env.ZEPTOMAIL_TOKEN = "secret-token";
  process.env.ZEPTOMAIL_FROM_ADDRESS = "hello@example.com";
  process.env.ZEPTOMAIL_FROM_NAME = "Girish Creations";
  process.env.ZEPTOMAIL_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1.1/email`;
});

const message = { to: [{ address: "owner@example.com", name: "Owner" }], subject: "Hi", textBody: "Hello" };

test("does nothing, and reports it, until it's configured", async () => {
  delete process.env.ZEPTOMAIL_TOKEN;
  assert.equal(isEmailEnabled(), false);
  assert.equal(await sendEmail(message), null);
  assert.equal(lastRequest, null);
});

test("sends ZeptoMail's format and returns the request id", async () => {
  const id = await sendEmail({
    ...message,
    htmlBody: "<p>Hello</p>",
    replyTo: { address: "visitor@example.com", name: "Visitor" },
    clientReference: "contact-1",
  });
  assert.equal(id, "req-1");
  assert.equal(lastRequest?.headers.authorization, "Zoho-enczapikey secret-token");
  assert.deepEqual(lastRequest?.body, {
    from: { address: "hello@example.com", name: "Girish Creations" },
    to: [{ email_address: { address: "owner@example.com", name: "Owner" } }],
    reply_to: [{ address: "visitor@example.com", name: "Visitor" }],
    subject: "Hi",
    textbody: "Hello",
    htmlbody: "<p>Hello</p>",
    client_reference: "contact-1",
  });
});

test("replies go to the shared inbox unless an email names someone else", async () => {
  delete process.env.ZEPTOMAIL_REPLY_TO;
  await sendEmail({ ...message, fromName: "RunMitra" });
  assert.deepEqual(lastRequest?.body.reply_to, [{ address: "runmithra@gmail.com", name: "RunMitra" }]);

  process.env.ZEPTOMAIL_REPLY_TO = "help@example.com";
  await sendEmail(message);
  assert.deepEqual(lastRequest?.body.reply_to, [{ address: "help@example.com", name: "Girish Creations" }]);
  delete process.env.ZEPTOMAIL_REPLY_TO;
});

test("an email can say which app it's from", async () => {
  await sendEmail({ ...message, fromName: "RunMitra" });
  assert.deepEqual(lastRequest?.body.from, { address: "hello@example.com", name: "RunMitra" });
});

test("sends inline images in ZeptoMail's format", async () => {
  await sendEmail({ ...message, inlineImages: [{ cid: "logo", mimeType: "image/png", content: "QUJD" }] });
  assert.deepEqual(lastRequest?.body.inline_images, [{ cid: "logo", mime_type: "image/png", content: "QUJD" }]);
});

test("a token pasted with its scheme isn't doubled up", async () => {
  process.env.ZEPTOMAIL_TOKEN = "Zoho-enczapikey secret-token";
  await sendEmail(message);
  assert.equal(lastRequest?.headers.authorization, "Zoho-enczapikey secret-token");
});

test("reports the current host's error format", async () => {
  reply = { status: 400, body: JSON.stringify({ data: { error_code: "TM_3004", message: "Invalid request" }, message: "error" }) };
  await assert.rejects(sendEmail(message), (error: EmailError) => {
    assert.equal(error.code, "TM_3004");
    assert.equal(error.message, "Invalid request");
    return true;
  });
});

test("reports the older host's error format", async () => {
  reply = { status: 401, body: JSON.stringify({ error: { code: "TM_1000", message: "Invalid API Token found" } }) };
  await assert.rejects(sendEmail(message), (error: EmailError) => error.code === "TM_1000");
});

test("prefers the specific reason over a vague \"Access Denied\"", async () => {
  reply = {
    status: 401,
    body: JSON.stringify({ error: { code: "TM_4001", message: "Access Denied", details: [{ code: "SERR_157", message: "Invalid API Token found" }] } }),
  };
  await assert.rejects(sendEmail(message), (error: EmailError) => {
    assert.equal(error.code, "TM_4001");
    assert.equal(error.message, "Invalid API Token found");
    return true;
  });
});

test("a failure without a readable body still gives a usable error", async () => {
  reply = { status: 502, body: "<html>Bad gateway</html>" };
  await assert.rejects(sendEmail(message), (error: EmailError) => error.code === "502");
});

test("an unreachable server is an EmailError, and doesn't expose the token", async () => {
  process.env.ZEPTOMAIL_API_URL = "http://127.0.0.1:1/v1.1/email";
  await assert.rejects(sendEmail(message), (error: EmailError) => {
    assert.equal(error.code, "NETWORK");
    assert.ok(!error.message.includes("secret-token"));
    return true;
  });
});
