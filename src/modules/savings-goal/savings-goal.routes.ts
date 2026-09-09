import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  addSavingsContributionHandler,
  createSavingsGoalHandler,
  deleteSavingsContributionHandler,
  deleteSavingsGoalHandler,
  listSavingsGoalsHandler,
  updateSavingsGoalHandler,
} from "./savings-goal.controller";

const requireExpenseAccess = requireModuleAccess("savings");

export const savingsGoalAdminRouter = Router();
savingsGoalAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listSavingsGoalsHandler));
savingsGoalAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createSavingsGoalHandler));
savingsGoalAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(updateSavingsGoalHandler),
);
savingsGoalAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteSavingsGoalHandler),
);
savingsGoalAdminRouter.post(
  "/:id/contributions",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(addSavingsContributionHandler),
);
savingsGoalAdminRouter.delete(
  "/:id/contributions/:contributionId",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteSavingsContributionHandler),
);
