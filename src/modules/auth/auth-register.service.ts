import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { EmailError, isEmailEnabled, sendEmail } from "../../lib/email";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/httpError";
import { normalizeMobile } from "../../utils/mobile";
import {
  buildCodeEmail,
  CODE_TTL_MINUTES,
  codeMatches,
  generateCode,
  hashCode,
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
} from "./auth-code";
import { canSignIn, findByIdentifier, issueToken, signInProblem } from "./auth.service";

// Pocket's sign-in screen asks for an email or mobile number first, then
// either signs in (the account exists) or signs up (it doesn't). Signing up
// needs an email address, verified with an emailed code before any account
// is made. A self-made account can use Pocket (Expenses and Savings) and
// nothing else: no portfolio, no super admin.

const codeExpired = (message = "This code has expired. Ask for a new one.") =>
  new HttpError(400, message, "CODE_EXPIRED");

const accountExists = () =>
  new HttpError(409, "An account already uses this email. Sign in instead.", "ACCOUNT_EXISTS");

// Whether to show the sign-in or the sign-up step. A guest (someone added to
// a split, with no login) counts as new: signing up with their email turns the
// guest into their account. Like the sign-in errors, this tells whether an
// account exists; the rate limits keep it from being used to list them.
export async function lookup(identifier: string) {
  if (!identifier.includes("@") && !normalizeMobile(identifier)) {
    throw new HttpError(400, "Enter a valid email or 10-digit mobile number.", "INVALID_IDENTIFIER");
  }
  const admin = await findByIdentifier(identifier);
  if (admin && !admin.isActive) throw signInProblem(admin, identifier);
  if (admin && canSignIn(admin)) {
    return { exists: true, canUseCode: admin.email !== null };
  }
  return { exists: false, canUseCode: false };
}

// Stops sign-up for an address that already has a working (or deactivated)
// account. A guest with this address may go ahead.
async function assertEmailFree(email: string) {
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (!existing) return;
  if (!existing.isActive) throw signInProblem(existing, email);
  if (canSignIn(existing)) throw accountExists();
}

// Emails a code to verify the address, keeping the name and password until
// it's entered. Asking again replaces the earlier code (and details).
export async function requestRegistration(input: { email: string; name: string; password: string }) {
  const email = input.email.toLowerCase();
  await assertEmailFree(email);
  if (!isEmailEnabled()) {
    throw new HttpError(503, "Sign-up isn't available right now. Please try again later.", "EMAIL_OFF");
  }

  const previous = await prisma.pendingRegistration.findUnique({ where: { email } });
  if (previous) {
    const waitSeconds = Math.ceil(RESEND_COOLDOWN_SECONDS - (Date.now() - previous.createdAt.getTime()) / 1000);
    if (waitSeconds > 0) {
      throw new HttpError(429, `A code was just sent. You can ask for another in ${waitSeconds} seconds.`, "CODE_COOLDOWN");
    }
    await prisma.pendingRegistration.deleteMany({ where: { email } });
  }

  // The hash is tied to the row's id, which only exists once it's created.
  const code = generateCode();
  const created = await prisma.pendingRegistration.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await bcrypt.hash(input.password, 10),
      codeHash: "",
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  });
  await prisma.pendingRegistration.update({
    where: { id: created.id },
    data: { codeHash: hashCode(code, created.id, "register", env.jwtSecret) },
  });

  try {
    await sendEmail(buildCodeEmail({ address: email, name: created.name }, code, "register"));
  } catch (error) {
    // They never got it, so don't make them wait out the cooldown to retry.
    await prisma.pendingRegistration.deleteMany({ where: { id: created.id } });
    const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
    console.error("Couldn't email a sign-up code:", reason);
    throw new HttpError(502, "We couldn't send the email just now. Please try again shortly.", "EMAIL_FAILED");
  }

  return { sentTo: email, expiresInMinutes: CODE_TTL_MINUTES, resendInSeconds: RESEND_COOLDOWN_SECONDS };
}

// Checks the code, then creates the account (or turns the guest with this
// email into it) and signs in.
export async function verifyRegistration(rawEmail: string, code: string, remember = false) {
  const email = rawEmail.toLowerCase();
  const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
  if (!pending || pending.expiresAt.getTime() <= Date.now()) throw codeExpired();

  // Counted before comparing, and atomically, as for sign-in codes.
  const counted = await prisma.pendingRegistration.updateMany({
    where: { id: pending.id, attempts: { lt: MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) {
    await prisma.pendingRegistration.deleteMany({ where: { id: pending.id } });
    throw codeExpired("Too many wrong tries. Ask for a new code.");
  }
  if (!codeMatches(code, pending.codeHash, pending.id, "register", env.jwtSecret)) {
    throw new HttpError(400, "That code isn't right.", "WRONG_CODE");
  }
  const used = await prisma.pendingRegistration.deleteMany({ where: { id: pending.id } });
  if (used.count === 0) throw codeExpired();

  // Checked again: someone may have been given a login since the code was sent.
  await assertEmailFree(email);
  const access = { hasPortfolioAccess: false, hasExpensesAccess: true, hasSavingsAccess: true };
  const guest = await prisma.adminUser.findUnique({ where: { email } });
  let account;
  if (guest) {
    account = await prisma.adminUser.update({
      where: { id: guest.id },
      data: {
        ...access,
        name: pending.name,
        passwordHash: pending.passwordHash,
        sessionVersion: (guest.sessionVersion ?? 0) + 1,
      },
    });
  } else {
    try {
      account = await prisma.adminUser.create({
        data: { ...access, email, name: pending.name, passwordHash: pending.passwordHash },
      });
    } catch (error) {
      // Two sign-ups for one address finishing at once.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw accountExists();
      throw error;
    }
  }
  return issueToken(account, remember);
}
