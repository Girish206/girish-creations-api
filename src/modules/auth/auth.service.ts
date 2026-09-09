import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../utils/httpError";
import type { AdminTokenPayload } from "../../types/express";

export async function login(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  // A guest member (added purely to appear in expense-split / savings-holder
  // pickers) has no passwordHash and can never log in until one is set.
  if (!admin || !admin.isActive || !admin.passwordHash || !admin.email) {
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
    hasPortfolioAccess: admin.hasPortfolioAccess,
    hasExpensesAccess: admin.hasExpensesAccess,
    hasInvestmentsAccess: admin.hasInvestmentsAccess,
    hasSavingsAccess: admin.hasSavingsAccess,
  };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });

  return {
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      isOwner: admin.isOwner,
      hasPortfolioAccess: admin.hasPortfolioAccess,
      hasExpensesAccess: admin.hasExpensesAccess,
      hasInvestmentsAccess: admin.hasInvestmentsAccess,
      hasSavingsAccess: admin.hasSavingsAccess,
    },
  };
}
