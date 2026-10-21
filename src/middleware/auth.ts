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

export type AdminModule = "portfolio" | "expenses" | "savings";

const accessField: Record<AdminModule, keyof AdminTokenPayload> = {
  portfolio: "hasPortfolioAccess",
  expenses: "hasExpensesAccess",
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
  const hasAccess = admin?.hasExpensesAccess || admin?.hasSavingsAccess;
  if (!hasAccess) {
    throw ForbiddenError("No access to the expense tracker");
  }
  next();
}

export function isSuperAdmin(admin: AdminTokenPayload | undefined): boolean {
  return Boolean(admin?.isSuperAdmin || admin?.isOwner);
}

// Must run after requireAdminAuth. Super admins manage every account; other
// Money Hub members may add and manage people of their own for expenses and
// savings (limits enforced in admin-user.service.ts).
export function requireAccountManager(req: Request, _res: Response, next: NextFunction) {
  const admin = req.admin;
  if (!isSuperAdmin(admin) && !admin?.hasExpensesAccess && !admin?.hasSavingsAccess) {
    throw ForbiddenError("No access to manage members");
  }
  next();
}

// Must run after requireAdminAuth. Players with cricket access (their own
// stats, matches and tournaments) and super admins (who manage it all).
export function requireCricketAccess(req: Request, _res: Response, next: NextFunction) {
  if (!isSuperAdmin(req.admin) && !req.admin?.hasCricketAccess) {
    throw ForbiddenError("No access to the cricket module");
  }
  next();
}

// Must run after requireAdminAuth.
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isSuperAdmin(req.admin)) {
    throw ForbiddenError("Super admin access required");
  }
  next();
}
