import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { createSkillHandler, deleteSkillHandler, listSkillHandler, updateSkillHandler } from "./skill.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const skillPublicRouter = Router();
skillPublicRouter.get("/", asyncHandler(listSkillHandler));

export const skillAdminRouter = Router();
skillAdminRouter.post("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(createSkillHandler));
skillAdminRouter.put("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(updateSkillHandler));
skillAdminRouter.delete("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(deleteSkillHandler));
