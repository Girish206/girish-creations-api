import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  addDirectSettlementHandler,
  createExpenseHandler,
  deleteDirectSettlementHandler,
  deleteExpenseHandler,
  getDirectBalancesHandler,
  getExpenseHandler,
  listExpenseMonthsHandler,
  listExpensesHandler,
  remindDirectDebtHandler,
  setExpenseDisputeHandler,
  updateExpenseHandler,
} from "./expense.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseAdminRouter = Router();
expenseAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpensesHandler));
expenseAdminRouter.get("/months", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpenseMonthsHandler));
expenseAdminRouter.get("/direct-balances", requireAdminAuth, requireExpenseAccess, asyncHandler(getDirectBalancesHandler));
expenseAdminRouter.post(
  "/direct-settlements",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(addDirectSettlementHandler),
);
expenseAdminRouter.post(
  "/direct-reminders",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(remindDirectDebtHandler),
);
expenseAdminRouter.delete(
  "/direct-settlements/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteDirectSettlementHandler),
);
expenseAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createExpenseHandler));
expenseAdminRouter.get("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(getExpenseHandler));
expenseAdminRouter.put("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(updateExpenseHandler));
expenseAdminRouter.delete("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(deleteExpenseHandler));
// Someone sharing an expense says their share isn't right, or takes it back.
expenseAdminRouter.put("/:id/dispute", requireAdminAuth, requireExpenseAccess, asyncHandler(setExpenseDisputeHandler));
