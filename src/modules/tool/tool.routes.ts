import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { createToolHandler, deleteToolHandler, listToolHandler, updateToolHandler } from "./tool.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const toolPublicRouter = Router();
toolPublicRouter.get("/", asyncHandler(listToolHandler));

export const toolAdminRouter = Router();
toolAdminRouter.post("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(createToolHandler));
toolAdminRouter.put("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(updateToolHandler));
toolAdminRouter.delete("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(deleteToolHandler));
