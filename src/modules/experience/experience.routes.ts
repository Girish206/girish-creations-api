import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createExperienceHandler,
  deleteExperienceHandler,
  listExperienceHandler,
  updateExperienceHandler,
} from "./experience.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const experiencePublicRouter = Router();
experiencePublicRouter.get("/", asyncHandler(listExperienceHandler));

export const experienceAdminRouter = Router();
experienceAdminRouter.post("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(createExperienceHandler));
experienceAdminRouter.put("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(updateExperienceHandler));
experienceAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(deleteExperienceHandler),
);
