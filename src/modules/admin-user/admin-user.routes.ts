import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireAnyExpenseAccess, requireOwner } from "../../middleware/auth";
import {
  createAdminUserHandler,
  deleteAdminUserHandler,
  listAdminUsersHandler,
  listExpenseMembersHandler,
  updateAdminUserHandler,
} from "./admin-user.controller";

// Owner-only: managing who can log in and which module(s) they can see.
export const adminUserAdminRouter = Router();
adminUserAdminRouter.get("/", requireAdminAuth, requireOwner, asyncHandler(listAdminUsersHandler));
adminUserAdminRouter.post("/", requireAdminAuth, requireOwner, asyncHandler(createAdminUserHandler));
adminUserAdminRouter.put("/:id", requireAdminAuth, requireOwner, asyncHandler(updateAdminUserHandler));
adminUserAdminRouter.delete("/:id", requireAdminAuth, requireOwner, asyncHandler(deleteAdminUserHandler));

// Any expense-module member (not owner-only): a minimal id/email/name list
// used to populate "who" pickers (savings account holder, expense split
// participants) without exposing full account-management data.
export const expenseMembersAdminRouter = Router();
expenseMembersAdminRouter.get(
  "/",
  requireAdminAuth,
  requireAnyExpenseAccess,
  asyncHandler(listExpenseMembersHandler),
);
