import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createExperienceHandler,
  deleteExperienceHandler,
  listExperienceHandler,
  updateExperienceHandler,
} from "./experience.controller";

export const experiencePublicRouter = Router();
experiencePublicRouter.get("/", asyncHandler(listExperienceHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const experienceAdminRouter = Router();
experienceAdminRouter.post("/", asyncHandler(createExperienceHandler));
experienceAdminRouter.put("/:id", asyncHandler(updateExperienceHandler));
experienceAdminRouter.delete("/:id", asyncHandler(deleteExperienceHandler));
