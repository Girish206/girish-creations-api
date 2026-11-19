import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import {
  createExpenseCategoryHandler,
  deleteExpenseCategoryHandler,
  listExpenseCategoriesHandler,
  mergeExpenseCategoryHandler,
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
// Anyone with expense access adds a category: a super admin's goes into the
// shared list, anyone else's is a custom one only they see. Who may change,
// merge or remove which is checked in expense-category.service.ts (shared:
// super admin; custom: its owner).
expenseCategoryAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  upload.single("image"),
  asyncHandler(updateExpenseCategoryHandler),
);
expenseCategoryAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteExpenseCategoryHandler),
);
// Tidying duplicates: one category's expenses move into another, then it goes.
expenseCategoryAdminRouter.post(
  "/:id/merge",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(mergeExpenseCategoryHandler),
);
