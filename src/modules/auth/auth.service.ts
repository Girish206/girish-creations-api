import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { AdminUser } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { HttpError, UnauthorizedError } from "../../utils/httpError";
import { normalizeMobile } from "../../utils/mobile";
import type { AdminTokenPayload } from "../../types/express";

// Finds the account for an email address or a mobile number.
async function findByIdentifier(identifier: string) {
  if (identifier.includes("@")) {
    return prisma.adminUser.findUnique({ where: { email: identifier.toLowerCase() } });
  }
  const mobile = normalizeMobile(identifier);
  return mobile ? prisma.adminUser.findFirst({ where: { mobile } }) : null;
}

// A guest member (added purely to appear in expense-split / savings-holder
// pickers) has no passwordHash and can never log in until one is set.
const canSignIn = (admin: AdminUser) =>
  admin.isActive && admin.passwordHash !== null && (admin.email !== null || admin.mobile !== null);

// Signs a token for the account as it is now. `remember` makes it a
// long-lived session (env.jwtRememberExpiresIn) instead of env.jwtExpiresIn.
export function issueToken(admin: AdminUser, remember = false) {
  const payload: AdminTokenPayload = {
    sub: String(admin.id),
    app: "admin",
    email: admin.email,
    name: admin.name,
    isOwner: admin.isOwner,
    isSuperAdmin: admin.isOwner || admin.isSuperAdmin,
    hasPortfolioAccess: admin.hasPortfolioAccess,
    hasExpensesAccess: admin.hasExpensesAccess,
    hasSavingsAccess: admin.hasSavingsAccess,
    ...(remember ? { remember: true } : {}),
    sv: admin.sessionVersion ?? 0,
  };
  const expiresIn = (remember ? env.jwtRememberExpiresIn : env.jwtExpiresIn) as jwt.SignOptions["expiresIn"];
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn });

  return {
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      isOwner: admin.isOwner,
      isSuperAdmin: admin.isOwner || admin.isSuperAdmin,
      hasPortfolioAccess: admin.hasPortfolioAccess,
      hasExpensesAccess: admin.hasExpensesAccess,
      hasSavingsAccess: admin.hasSavingsAccess,
    },
  };
}

// Why an account can't sign in, so the login screen can say what's wrong. This
// does tell whether an account exists; the rate limits on /login keep it from
// being used to list them.
export function signInProblem(admin: Pick<AdminUser, "isActive"> | null, identifier: string) {
  if (!admin) {
    const kind = identifier.includes("@") ? "email" : "mobile number";
    return new HttpError(401, `No account uses this ${kind}.`, "UNKNOWN_ACCOUNT");
  }
  if (!admin.isActive) {
    return new HttpError(401, "This account has been deactivated.", "ACCOUNT_INACTIVE");
  }
  return new HttpError(401, "This account can't sign in yet. Ask an administrator for access.", "NO_LOGIN");
}

// The account for an email or mobile number, as long as it's allowed to sign in
// at all. Every way of signing in goes through this.
export async function findSignInAccount(identifier: string) {
  if (!identifier.includes("@") && !normalizeMobile(identifier)) {
    throw new HttpError(400, "Enter a valid email or 10-digit mobile number.", "INVALID_IDENTIFIER");
  }
  const admin = await findByIdentifier(identifier);
  if (!admin || !canSignIn(admin)) throw signInProblem(admin, identifier);
  return admin;
}

export async function login(identifier: string, password: string, remember = false) {
  const admin = await findSignInAccount(identifier);
  const valid = await bcrypt.compare(password, admin.passwordHash!);
  if (!valid) {
    throw new HttpError(401, "That password isn't right.", "WRONG_PASSWORD");
  }

  return issueToken(admin, remember);
}

// Swaps a still-valid token for a fresh one carrying the account's current
// name and access, so a remembered session keeps sliding forward. `remember`
// turns a short session into a remembered one. Fails once the account is
// deactivated or loses its password.
export async function refresh(current: AdminTokenPayload, remember = false) {
  const admin = await prisma.adminUser.findUnique({ where: { id: BigInt(current.sub) } });
  if (!admin || !canSignIn(admin) || (current.sv ?? 0) !== (admin.sessionVersion ?? 0)) {
    throw UnauthorizedError("This account can no longer sign in");
  }
  return issueToken(admin, Boolean(current.remember) || remember);
}

// Signs this account out on every device: tokens issued before now stop
// working on the next request (requireAdminAuth) or refresh.
export async function signOutEverywhere(adminId: bigint) {
  await prisma.adminUser.update({ where: { id: adminId }, data: { sessionVersion: { increment: 1 } } });
}
