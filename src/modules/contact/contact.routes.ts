import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { createContactHandler, listContactHandler, deleteContactHandler } from "./contact.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const contactPublicRouter = Router();
contactPublicRouter.post("/", asyncHandler(createContactHandler));

export const contactAdminRouter = Router();
contactAdminRouter.get("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(listContactHandler));
contactAdminRouter.delete("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(deleteContactHandler));
