import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess, requireSuperAdmin } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
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
  upload.single("image"),
  asyncHandler(createExpenseCategoryHandler),
);
// Categories are shared by everyone, so anyone can add one but only a super
// admin can change or remove what others are using.
expenseCategoryAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  requireSuperAdmin,
  upload.single("image"),
  asyncHandler(updateExpenseCategoryHandler),
);
expenseCategoryAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  requireSuperAdmin,
  asyncHandler(deleteExpenseCategoryHandler),
);
