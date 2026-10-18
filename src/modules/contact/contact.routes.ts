import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { createContactHandler, listContactHandler, deleteContactHandler } from "./contact.controller";

export const contactPublicRouter = Router();
contactPublicRouter.post("/", asyncHandler(createContactHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const contactAdminRouter = Router();
contactAdminRouter.get("/", asyncHandler(listContactHandler));
contactAdminRouter.delete("/:id", asyncHandler(deleteContactHandler));
