import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { rateLimit } from "../../middleware/rateLimit";
import { createContactHandler, listContactHandler, deleteContactHandler } from "./contact.controller";

export const contactPublicRouter = Router();
// Open to anyone, and each message can send an email: this stops someone
// flooding an owner's inbox or using up the email allowance.
contactPublicRouter.post("/", asyncHandler(rateLimit("contact-ip", 5, 15 * 60_000)), asyncHandler(createContactHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const contactAdminRouter = Router();
contactAdminRouter.get("/", asyncHandler(listContactHandler));
contactAdminRouter.delete("/:id", asyncHandler(deleteContactHandler));
