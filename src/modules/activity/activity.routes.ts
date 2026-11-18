import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireAnyExpenseAccess } from "../../middleware/auth";
import { listActivityHandler } from "./activity.controller";

// The Money Hub's history: who changed what, limited to what concerns each person.
export const activityAdminRouter = Router();
activityAdminRouter.get("/", requireAdminAuth, requireAnyExpenseAccess, asyncHandler(listActivityHandler));
