import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createExpenseGroupHandler,
  deleteExpenseGroupHandler,
  listExpenseGroupsHandler,
  updateExpenseGroupHandler,
} from "./expense-group.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseGroupAdminRouter = Router();
expenseGroupAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpenseGroupsHandler));
expenseGroupAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createExpenseGroupHandler));
expenseGroupAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(updateExpenseGroupHandler),
);
expenseGroupAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteExpenseGroupHandler),
);
