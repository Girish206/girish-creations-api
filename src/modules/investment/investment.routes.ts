import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createInvestmentHandler,
  deleteInvestmentHandler,
  listInvestmentsHandler,
  updateInvestmentHandler,
} from "./investment.controller";

const requireExpenseAccess = requireModuleAccess("investments");

export const investmentAdminRouter = Router();
investmentAdminRouter.get("/", requireAdminAuth, requireExpenseAccess, asyncHandler(listInvestmentsHandler));
investmentAdminRouter.post("/", requireAdminAuth, requireExpenseAccess, asyncHandler(createInvestmentHandler));
investmentAdminRouter.put("/:id", requireAdminAuth, requireExpenseAccess, asyncHandler(updateInvestmentHandler));
investmentAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requireExpenseAccess,
  asyncHandler(deleteInvestmentHandler),
);
