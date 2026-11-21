import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  addSettlementHandler,
  createExpenseGroupHandler,
  deleteSettlementHandler,
  deleteExpenseGroupHandler,
  listExpenseGroupsHandler,
  listGroupExpensesHandler,
  remindGroupDebtHandler,
  sendSplitEmailHandler,
  setExpenseGroupClosedHandler,
  setExpenseGroupSettlingHandler,
  updateExpenseGroupHandler,
} from "./expense-group.controller";

const requireExpenseAccess = requireModuleAccess("expenses");

export const expenseGroupAdminRouter = Router();
expenseGroupAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listExpenseGroupsHandler));
expenseGroupAdminRouter.get(
  "/:id/expenses",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(listGroupExpensesHandler),
);
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
expenseGroupAdminRouter.put(
  "/:id/status",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(setExpenseGroupClosedHandler),
);
expenseGroupAdminRouter.put(
  "/:id/settling",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(setExpenseGroupSettlingHandler),
);
expenseGroupAdminRouter.post(
  "/:id/split-email",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(sendSplitEmailHandler),
);
expenseGroupAdminRouter.post(
  "/:id/reminders",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(remindGroupDebtHandler),
);
expenseGroupAdminRouter.post(
  "/:id/settlements",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(addSettlementHandler),
);
expenseGroupAdminRouter.delete(
  "/:id/settlements/:settlementId",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteSettlementHandler),
);
