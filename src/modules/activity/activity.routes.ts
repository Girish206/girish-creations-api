import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireAnyExpenseAccess } from "../../middleware/auth";
import { listActivityHandler, listNotificationsHandler, markNotificationsSeenHandler } from "./activity.controller";

// The Money Hub's history: who changed what, limited to what concerns each person.
export const activityAdminRouter = Router();
activityAdminRouter.get("/", requireAdminAuth, requireAnyExpenseAccess, asyncHandler(listActivityHandler));
// What other people did that concerns you, and how much of it is new.
activityAdminRouter.get(
  "/notifications",
  requireAdminAuth,
  requireAnyExpenseAccess,
  asyncHandler(listNotificationsHandler),
);
activityAdminRouter.put(
  "/notifications/seen",
  requireAdminAuth,
  requireAnyExpenseAccess,
  asyncHandler(markNotificationsSeenHandler),
);
