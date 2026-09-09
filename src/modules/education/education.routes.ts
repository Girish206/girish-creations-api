import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createEducationHandler,
  deleteEducationHandler,
  listEducationHandler,
  updateEducationHandler,
} from "./education.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const educationPublicRouter = Router();
educationPublicRouter.get("/", asyncHandler(listEducationHandler));

export const educationAdminRouter = Router();
educationAdminRouter.post("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(createEducationHandler));
educationAdminRouter.put("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(updateEducationHandler));
educationAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(deleteEducationHandler),
);
