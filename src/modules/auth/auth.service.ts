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
    email: admin.email,
    name: admin.name,
    isOwner: admin.isOwner,
    isSuperAdmin: admin.isOwner || admin.isSuperAdmin,
    hasPortfolioAccess: admin.hasPortfolioAccess,
    hasExpensesAccess: admin.hasExpensesAccess,
    hasSavingsAccess: admin.hasSavingsAccess,
    hasCricketAccess: admin.hasCricketAccess,
    ...(remember ? { remember: true } : {}),
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
      hasCricketAccess: admin.hasCricketAccess,
    },
  };
}

export async function login(identifier: string, password: string, remember = false) {
  const admin = await findByIdentifier(identifier);
  if (!admin || !canSignIn(admin)) {
    // An organiser added this number to the cricket pool (or as a guest)
    // but nobody has set a password for it yet: point them at sign-up.
    const mobile = identifier.includes("@") ? null : normalizeMobile(identifier);
    const pendingPlayer =
      mobile && (!admin || (admin.isActive && admin.passwordHash === null))
        ? await prisma.cricketPlayer.findFirst({ where: { mobile } })
        : null;
    if (pendingPlayer) {
      throw new HttpError(401, "This number has no password yet. Create your account to set one.", "NO_PASSWORD");
    }
    throw UnauthorizedError("Invalid email or password");
  }

  const valid = await bcrypt.compare(password, admin.passwordHash!);
  if (!valid) {
    throw UnauthorizedError("Invalid email or password");
  }

  return issueToken(admin, remember);
}

// Swaps a still-valid token for a fresh one carrying the account's current
// name and access, so a remembered session keeps sliding forward. `remember`
// turns a short session into a remembered one. Fails once the account is
// deactivated or loses its password.
export async function refresh(current: AdminTokenPayload, remember = false) {
  const admin = await prisma.adminUser.findUnique({ where: { id: BigInt(current.sub) } });
  if (!admin || !canSignIn(admin)) {
    throw UnauthorizedError("This account can no longer sign in");
  }
  return issueToken(admin, Boolean(current.remember) || remember);
}
