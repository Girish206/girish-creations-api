import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import { getProfileHandler, updateProfileHandler } from "./profile.controller";

export const profilePublicRouter = Router();
profilePublicRouter.get("/", asyncHandler(getProfileHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const profileAdminRouter = Router();
profileAdminRouter.put(
  "/",
  upload.fields([
    { name: "profilePicture", maxCount: 1 },
    { name: "signature", maxCount: 1 },
    { name: "resume", maxCount: 1 },
  ]),
  asyncHandler(updateProfileHandler),
);
