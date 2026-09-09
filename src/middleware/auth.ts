import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ForbiddenError, UnauthorizedError } from "../utils/httpError";
import type { AdminTokenPayload } from "../types/express";

export function requireAdminAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AdminTokenPayload;
    req.admin = payload;
    next();
  } catch {
    throw UnauthorizedError("Invalid or expired token");
  }
}

export type AdminModule = "portfolio" | "expenses" | "investments" | "savings";

const accessField: Record<AdminModule, keyof AdminTokenPayload> = {
  portfolio: "hasPortfolioAccess",
  expenses: "hasExpensesAccess",
  investments: "hasInvestmentsAccess",
  savings: "hasSavingsAccess",
};

// Must run after requireAdminAuth (needs req.admin already populated).
export function requireModuleAccess(module: AdminModule) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const hasAccess = req.admin?.[accessField[module]];
    if (!hasAccess) {
      throw ForbiddenError(`No access to the ${module} module`);
    }
    next();
  };
}

// Must run after requireAdminAuth. For endpoints usable by any member with
// at least one expense-tracker sub-area enabled (e.g. the shared member
// picker, the module dashboard) rather than one specific sub-area.
export function requireAnyExpenseAccess(req: Request, _res: Response, next: NextFunction) {
  const admin = req.admin;
  const hasAccess = admin?.hasExpensesAccess || admin?.hasInvestmentsAccess || admin?.hasSavingsAccess;
  if (!hasAccess) {
    throw ForbiddenError("No access to the expense tracker");
  }
  next();
}

// Must run after requireAdminAuth.
export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.admin?.isOwner) {
    throw ForbiddenError("Owner access required");
  }
  next();
}
