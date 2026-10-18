import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAccountManager, requireAdminAuth, requireAnyExpenseAccess } from "../../middleware/auth";
import {
  createAdminUserHandler,
  deleteAdminUserHandler,
  listAdminUsersHandler,
  listExpenseMembersHandler,
  updateAdminUserHandler,
} from "./admin-user.controller";

// Super admins manage every account ("Admin Accounts"); other Money Hub
// members manage only people they added ("Members") — see the service.
export const adminUserAdminRouter = Router();
adminUserAdminRouter.get("/", requireAdminAuth, requireAccountManager, asyncHandler(listAdminUsersHandler));
adminUserAdminRouter.post("/", requireAdminAuth, requireAccountManager, asyncHandler(createAdminUserHandler));
adminUserAdminRouter.put("/:id", requireAdminAuth, requireAccountManager, asyncHandler(updateAdminUserHandler));
adminUserAdminRouter.delete("/:id", requireAdminAuth, requireAccountManager, asyncHandler(deleteAdminUserHandler));

// Any expense-module member (not super-admin-only): a minimal id/email/name list
// used to populate "who" pickers (savings account holder, expense split
// participants) without exposing full account-management data.
export const expenseMembersAdminRouter = Router();
expenseMembersAdminRouter.get(
  "/",
  requireAdminAuth,
  requireAnyExpenseAccess,
  asyncHandler(listExpenseMembersHandler),
);
