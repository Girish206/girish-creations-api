import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createExpenseHandler,
  deleteExpenseHandler,
  listExpensesHandler,
  updateExpenseHandler,
} from "./expense.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseAdminRouter = Router();
expenseAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpensesHandler));
expenseAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createExpenseHandler));
expenseAdminRouter.put("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(updateExpenseHandler));
expenseAdminRouter.delete("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(deleteExpenseHandler));
