import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  addDirectSettlementHandler,
  createExpenseHandler,
  deleteDirectSettlementHandler,
  deleteExpenseHandler,
  getDirectBalancesHandler,
  listExpensesHandler,
  updateExpenseHandler,
} from "./expense.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseAdminRouter = Router();
expenseAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpensesHandler));
expenseAdminRouter.get("/direct-balances", requireAdminAuth, requireExpenseAccess, asyncHandler(getDirectBalancesHandler));
expenseAdminRouter.post(
  "/direct-settlements",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(addDirectSettlementHandler),
);
expenseAdminRouter.delete(
  "/direct-settlements/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteDirectSettlementHandler),
);
expenseAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createExpenseHandler));
expenseAdminRouter.put("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(updateExpenseHandler));
expenseAdminRouter.delete("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(deleteExpenseHandler));
