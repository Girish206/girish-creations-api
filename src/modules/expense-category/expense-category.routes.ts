import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createExpenseCategoryHandler,
  deleteExpenseCategoryHandler,
  listExpenseCategoriesHandler,
  updateExpenseCategoryHandler,
} from "./expense-category.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseCategoryAdminRouter = Router();
expenseCategoryAdminRouter.get(
  "/",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(listExpenseCategoriesHandler),
);
expenseCategoryAdminRouter.post(
  "/",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(createExpenseCategoryHandler),
);
expenseCategoryAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(updateExpenseCategoryHandler),
);
expenseCategoryAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteExpenseCategoryHandler),
);
