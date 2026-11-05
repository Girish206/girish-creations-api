import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { EmailError, isEmailEnabled, sendEmail } from "../../lib/email";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/httpError";
import type { AuthApp } from "../../types/express";
import {
  buildCodeEmail,
  buildPasswordChangedEmail,
  CODE_TTL_MINUTES,
  codeMatches,
  type CodePurpose,
  generateCode,
  hashCode,
  maskEmail,
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
} from "./auth-code";
import { findSignInAccount, issueToken } from "./auth.service";

const codeExpired = (message = "This code has expired. Ask for a new one.") =>
  new HttpError(400, message, "CODE_EXPIRED");

// Emails a fresh code, replacing any earlier one. Only an account that can
// already sign in may ask: a guest whose login was removed, or a deactivated
// account, can't get back in this way.
export async function requestCode(identifier: string, purpose: CodePurpose, app: AuthApp) {
  const account = await findSignInAccount(identifier);
  if (!account.email) {
    throw new HttpError(
      400,
      "This account has no email address, so we can't send it a code. Sign in with your password, or ask an organiser or administrator to reset it.",
      "NO_EMAIL",
    );
  }
  if (!isEmailEnabled()) {
    throw new HttpError(503, "Email codes aren't available right now. Sign in with your password.", "EMAIL_OFF");
  }

  const where = { adminUserId: account.id, purpose };
  const previous = await prisma.authCode.findFirst({ where, orderBy: { createdAt: "desc" } });
  if (previous) {
    const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - (Date.now() - previous.createdAt.getTime()) / 1000);
    if (waitSeconds > 0) {
      throw new HttpError(429, `A code was just sent. You can ask for another in ${waitSeconds} seconds.`, "CODE_COOLDOWN");
    }
  }

  const code = generateCode();
  await prisma.authCode.deleteMany({ where });
  const created = await prisma.authCode.create({
    data: {
      adminUserId: account.id,
      purpose,
      codeHash: hashCode(code, account.id, purpose, env.jwtSecret),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  });

  try {
    await sendEmail(buildCodeEmail({ address: account.email, name: account.name ?? undefined }, code, purpose, app));
  } catch (error) {
    // They never got it, so don't make them wait out the cooldown to retry.
    await prisma.authCode.deleteMany({ where: { id: created.id } });
    const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
    console.error("Couldn't email a sign-in code:", reason);
    throw new HttpError(502, "We couldn't send the email just now. Please try again shortly.", "EMAIL_FAILED");
  }

  return {
    sentTo: maskEmail(account.email),
    expiresInMinutes: CODE_TTL_MINUTES,
    resendInSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

// Checks a code and uses it up, returning the account it was for.
async function consumeCode(identifier: string, code: string, purpose: CodePurpose) {
  const account = await findSignInAccount(identifier);
  const stored = await prisma.authCode.findFirst({
    where: { adminUserId: account.id, purpose },
    orderBy: { createdAt: "desc" },
  });
  if (!stored || stored.expiresAt.getTime() <= Date.now()) throw codeExpired();

  // Counted before comparing, and atomically, so guesses sent in parallel
  // can't get more tries than allowed.
  const counted = await prisma.authCode.updateMany({
    where: { id: stored.id, attempts: { lt: MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) {
    await prisma.authCode.deleteMany({ where: { id: stored.id } });
    throw codeExpired("Too many wrong tries. Ask for a new code.");
  }
  if (!codeMatches(code, stored.codeHash, account.id, purpose, env.jwtSecret)) {
    throw new HttpError(400, "That code isn't right.", "WRONG_CODE");
  }

  // Whoever deletes it is who used it, so it can't be used twice at once.
  const used = await prisma.authCode.deleteMany({ where: { id: stored.id } });
  if (used.count === 0) throw codeExpired();
  return account;
}

export async function loginWithCode(identifier: string, code: string, app: AuthApp, remember = false) {
  const account = await consumeCode(identifier, code, "login");
  return issueToken(account, app, remember);
}

// Sets a new password, ends every other session, and signs in on this device.
export async function resetPassword(
  identifier: string,
  code: string,
  newPassword: string,
  app: AuthApp,
  remember = false,
) {
  const account = await consumeCode(identifier, code, "reset");
  const updated = await prisma.adminUser.update({
    where: { id: account.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      sessionVersion: (account.sessionVersion ?? 0) + 1,
    },
  });
  // A sign-in code asked for earlier shouldn't outlive the old password.
  await prisma.authCode.deleteMany({ where: { adminUserId: account.id } });

  // The password has changed either way, so a failed notice is only logged.
  if (account.email) {
    await sendEmail(buildPasswordChangedEmail({ address: account.email, name: account.name ?? undefined }, app)).catch(
      (error: unknown) => {
        console.error("Couldn't send the password-changed notice:", error instanceof EmailError ? error.code : error);
      },
    );
  }
  return issueToken(updated, app, remember);
}
