import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { createSkillHandler, deleteSkillHandler, listSkillHandler, updateSkillHandler } from "./skill.controller";

export const skillPublicRouter = Router();
skillPublicRouter.get("/", asyncHandler(listSkillHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const skillAdminRouter = Router();
skillAdminRouter.post("/", asyncHandler(createSkillHandler));
skillAdminRouter.put("/:id", asyncHandler(updateSkillHandler));
skillAdminRouter.delete("/:id", asyncHandler(deleteSkillHandler));
