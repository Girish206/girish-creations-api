import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { createToolHandler, deleteToolHandler, listToolHandler, updateToolHandler } from "./tool.controller";

export const toolPublicRouter = Router();
toolPublicRouter.get("/", asyncHandler(listToolHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const toolAdminRouter = Router();
toolAdminRouter.post("/", asyncHandler(createToolHandler));
toolAdminRouter.put("/:id", asyncHandler(updateToolHandler));
toolAdminRouter.delete("/:id", asyncHandler(deleteToolHandler));
