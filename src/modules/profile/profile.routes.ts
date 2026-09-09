import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import { getProfileHandler, updateProfileHandler } from "./profile.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const profilePublicRouter = Router();
profilePublicRouter.get("/", asyncHandler(getProfileHandler));

export const profileAdminRouter = Router();
profileAdminRouter.put(
  "/",
  requireAdminAuth,
  requirePortfolioAccess,
  upload.fields([
    { name: "profilePicture", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  asyncHandler(updateProfileHandler),
);
