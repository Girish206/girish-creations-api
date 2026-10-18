import type { NextFunction, Request, Response } from "express";
import { getOrCreateOwnProfile, getVisibleProfileId } from "../modules/profile/profile.service";
import { prisma } from "../lib/prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/httpError";
import { isSuperAdmin } from "./auth";

// Every portfolio resource (experience, projects, blog, ...) belongs to one
// UserProfile. These middlewares decide which one a request is about, and
// the handlers below them read it back with scopedProfileId(req).

// Public reads: /api/portfolios/:username/...
export async function resolvePublicPortfolio(req: Request, _res: Response, next: NextFunction) {
  req.portfolioProfileId = await getVisibleProfileId(String(req.params.username));
  next();
}

// Admin reads and writes: the signed-in account's own portfolio — or, for a
// super admin, whichever account the X-Portfolio-User header names (the
// portfolio picker in the admin panel). Must run after requireAdminAuth.
export async function resolveOwnPortfolio(req: Request, _res: Response, next: NextFunction) {
  const requested = req.header("x-portfolio-user");
  let adminUserId = BigInt(req.admin!.sub);
  if (requested && requested !== req.admin!.sub) {
    if (!isSuperAdmin(req.admin)) {
      throw ForbiddenError("Only super admins can manage another account's portfolio");
    }
    if (!/^\d+$/.test(requested)) {
      throw BadRequestError("Invalid X-Portfolio-User header");
    }
    const target = await prisma.adminUser.findUnique({ where: { id: BigInt(requested) } });
    if (!target || !target.hasPortfolioAccess) {
      throw NotFoundError("That account has no portfolio");
    }
    adminUserId = target.id;
  }
  const profile = await getOrCreateOwnProfile(adminUserId);
  req.portfolioProfileId = profile.id;
  next();
}

export function scopedProfileId(req: Request): bigint {
  if (req.portfolioProfileId === undefined) {
    throw new Error("Portfolio scope middleware did not run for this route");
  }
  return req.portfolioProfileId;
}
