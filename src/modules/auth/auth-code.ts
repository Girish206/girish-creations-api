import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { EmailMessage } from "../../lib/email";
import { BRANDS, codeBlock, escapeHtml, finePrint, logoImages, paragraph, renderEmail } from "../../lib/email-layout";
import type { AuthApp } from "../../types/express";

// One-time codes emailed for signing in, or for setting a new password.
export type CodePurpose = "login" | "reset";

export const CODE_TTL_MINUTES = 10;
// Wrong guesses allowed on one code before it stops working. With 6 digits,
// this and the limit on requesting new codes put guessing out of reach.
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Six digits are trivial to brute-force from a plain hash, so it's keyed with a
// server secret: a leaked database alone doesn't give the codes away. Tied to
// the account and purpose so a code can't be moved to another of either.
export function hashCode(code: string, adminUserId: bigint, purpose: CodePurpose, secret: string) {
  return createHmac("sha256", secret).update(`${adminUserId}:${purpose}:${code}`).digest("hex");
}

export function codeMatches(code: string, storedHash: string, adminUserId: bigint, purpose: CodePurpose, secret: string) {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashCode(code, adminUserId, purpose, secret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Enough for someone to recognise their own address, and not much more, since
// anyone who knows a mobile number can ask where its code went. A fixed number
// of stars keeps it short and doesn't give away the address's length.
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.charAt(0)}***@${domain}`;
}

const firstNameOf = (name?: string) => name?.trim().split(/\s+/)[0];
const greeting = (name?: string) => (firstNameOf(name) ? `Hi ${firstNameOf(name)},` : "Hi,");

// The account and its password are shared between both apps.
const otherApp = (app: AuthApp) => BRANDS[app === "admin" ? "cricket" : "admin"].name;

export function buildCodeEmail(
  to: { address: string; name?: string },
  code: string,
  purpose: CodePurpose,
  app: AuthApp,
): EmailMessage {
  const brand = BRANDS[app];
  const isLogin = purpose === "login";
  const title = isLogin ? `Your ${brand.name} sign-in code` : `Reset your ${brand.name} password`;
  const intro = isLogin
    ? `Use this code to sign in to ${brand.name}.`
    : `Use this code to reset your password for ${brand.name}.`;
  const expiry = `Expires in ${CODE_TTL_MINUTES} minutes and works only once.`;
  const ignore = isLogin
    ? "Didn't ask for this? You can safely ignore this email: nobody can sign in without the code."
    : "Didn't ask for this? You can safely ignore this email and your password stays the same.";
  const share = `Never share this code. ${brand.name} will never ask you for it.`;
  return {
    fromName: brand.name,
    to: [to],
    subject: title,
    inlineImages: logoImages(brand),
    clientReference: `auth-${purpose}`,
    textBody: [
      greeting(to.name),
      "",
      intro,
      "",
      `Your code: ${code}`,
      "",
      expiry,
      "",
      ignore,
      share,
      "",
      `- ${brand.name}`,
    ].join("\n"),
    htmlBody: renderEmail({
      brand,
      title,
      // Inboxes show this line on lock screens, so it stays free of the code.
      preheader: `${intro} ${expiry}`,
      body: [
        paragraph(escapeHtml(greeting(to.name))),
        paragraph(intro),
        codeBlock(brand, code, expiry),
        finePrint(`${ignore}<br>${share}`),
      ].join("\n"),
      footer: `Sent by ${brand.name} because this code was requested for your account.`,
    }),
  };
}

export function buildPasswordChangedEmail(
  to: { address: string; name?: string },
  app: AuthApp,
  changedAt = new Date(),
): EmailMessage {
  const brand = BRANDS[app];
  const when = changedAt.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  const title = "Your password was changed";
  const notice = `Your ${brand.name} password was changed on ${when} IST, and your other devices will need to sign in again.`;
  const shared = `If you also use ${otherApp(app)} with this account, the new password works there too.`;
  const warning = "Wasn't you? Use Forgot password on the sign-in page straight away, and contact an administrator.";
  return {
    fromName: brand.name,
    to: [to],
    subject: `Your ${brand.name} password was changed`,
    inlineImages: logoImages(brand),
    clientReference: "auth-password-changed",
    textBody: [greeting(to.name), "", notice, "", shared, "", warning, "", `- ${brand.name}`].join("\n"),
    htmlBody: renderEmail({
      brand,
      title,
      preheader: `Your ${brand.name} password was changed on ${when} IST.`,
      body: [
        paragraph(escapeHtml(greeting(to.name))),
        paragraph(notice),
        paragraph(shared),
        finePrint(`<strong>Wasn't you?</strong> Use Forgot password on the sign-in page straight away, and contact an administrator.`),
      ].join("\n"),
      footer: `Sent by ${brand.name} to keep your account safe.`,
    }),
  };
}
