import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createEducationHandler,
  deleteEducationHandler,
  listEducationHandler,
  updateEducationHandler,
} from "./education.controller";

export const educationPublicRouter = Router();
educationPublicRouter.get("/", asyncHandler(listEducationHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const educationAdminRouter = Router();
educationAdminRouter.post("/", asyncHandler(createEducationHandler));
educationAdminRouter.put("/:id", asyncHandler(updateEducationHandler));
educationAdminRouter.delete("/:id", asyncHandler(deleteEducationHandler));
