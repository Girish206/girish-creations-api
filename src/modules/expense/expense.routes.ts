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
  setExpenseDisputeHandler,
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
// Someone sharing an expense says their share isn't right, or takes it back.
expenseAdminRouter.put("/:id/dispute", requireAdminAuth, requireExpenseAccess, asyncHandler(setExpenseDisputeHandler));
