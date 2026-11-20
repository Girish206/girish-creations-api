import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { EmailMessage } from "../../lib/email";
import { BRAND, codeBlock, escapeHtml, finePrint, paragraph, renderSimpleEmail } from "../../lib/email-layout";

// One-time codes emailed for signing in, for setting a new password, or for
// verifying the email address of someone signing up.
export type CodePurpose = "login" | "reset" | "register";

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

export function buildCodeEmail(to: { address: string; name?: string }, code: string, purpose: CodePurpose): EmailMessage {
  const brand = BRAND;
  const copy = {
    login: {
      title: `Your ${brand.name} sign-in code`,
      intro: `Use this code to sign in to ${brand.name}.`,
      ignore: "Didn't ask for this? You can safely ignore this email: nobody can sign in without the code.",
    },
    reset: {
      title: `Reset your ${brand.name} password`,
      intro: `Use this code to reset your password for ${brand.name}.`,
      ignore: "Didn't ask for this? You can safely ignore this email and your password stays the same.",
    },
    register: {
      title: `Verify your email for ${brand.name}`,
      intro: `Use this code to finish creating your ${brand.name} account.`,
      ignore: "Didn't sign up? You can safely ignore this email: no account is created without the code.",
    },
  }[purpose];
  const { title, intro, ignore } = copy;
  const expiry = `Expires in ${CODE_TTL_MINUTES} minutes and works only once.`;
  const share = `Never share this code. ${brand.name} will never ask you for it.`;
  return {
    fromName: brand.name,
    to: [to],
    subject: title,
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
    htmlBody: renderSimpleEmail({
      title,
      // Inboxes show this line on lock screens, so it stays free of the code.
      preheader: `${intro} ${expiry}`,
      body: [
        paragraph(escapeHtml(greeting(to.name))),
        paragraph(intro),
        codeBlock(brand, code, expiry),
        finePrint(`${ignore}<br>${share}`),
      ].join("\n"),
      footer:
        purpose === "register"
          ? `Sent by ${brand.name} because this address was used to sign up.`
          : `Sent by ${brand.name} because this code was requested for your account.`,
    }),
  };
}

export function buildPasswordChangedEmail(to: { address: string; name?: string }, changedAt = new Date()): EmailMessage {
  const brand = BRAND;
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
  const warning = "Wasn't you? Use Forgot password on the sign-in page straight away, and contact an administrator.";
  return {
    fromName: brand.name,
    to: [to],
    subject: `Your ${brand.name} password was changed`,
    clientReference: "auth-password-changed",
    textBody: [greeting(to.name), "", notice, "", warning, "", `- ${brand.name}`].join("\n"),
    htmlBody: renderSimpleEmail({
      title,
      preheader: `Your ${brand.name} password was changed on ${when} IST.`,
      body: [
        paragraph(escapeHtml(greeting(to.name))),
        paragraph(notice),
        finePrint(`<strong>Wasn't you?</strong> Use Forgot password on the sign-in page straight away, and contact an administrator.`),
      ].join("\n"),
      footer: `Sent by ${brand.name} to keep your account safe.`,
    }),
  };
}
