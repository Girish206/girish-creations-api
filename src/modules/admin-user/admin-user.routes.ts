import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireAnyExpenseAccess, requireSuperAdmin } from "../../middleware/auth";
import {
  createAdminUserHandler,
  deleteAdminUserHandler,
  listAdminUsersHandler,
  listExpenseMembersHandler,
  updateAdminUserHandler,
} from "./admin-user.controller";

// Super admins only: managing who can log in and which module(s) they can see.
export const adminUserAdminRouter = Router();
adminUserAdminRouter.get("/", requireAdminAuth, requireSuperAdmin, asyncHandler(listAdminUsersHandler));
adminUserAdminRouter.post("/", requireAdminAuth, requireSuperAdmin, asyncHandler(createAdminUserHandler));
adminUserAdminRouter.put("/:id", requireAdminAuth, requireSuperAdmin, asyncHandler(updateAdminUserHandler));
adminUserAdminRouter.delete("/:id", requireAdminAuth, requireSuperAdmin, asyncHandler(deleteAdminUserHandler));

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
