import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/httpError";
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

export async function login(identifier: string, password: string) {
  const admin = await findByIdentifier(identifier);
  // A guest member (added purely to appear in expense-split / savings-holder
  // pickers) has no passwordHash and can never log in until one is set.
  if (!admin || !admin.isActive || !admin.passwordHash || (!admin.email && !admin.mobile)) {
    throw UnauthorizedError("Invalid email or password");
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    throw UnauthorizedError("Invalid email or password");
  }

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
  };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });

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
