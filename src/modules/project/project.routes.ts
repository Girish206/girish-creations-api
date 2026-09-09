import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import {
  listProjectsHandler,
  randomProjectsHandler,
  getProjectHandler,
  createProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
} from "./project.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const projectPublicRouter = Router();
projectPublicRouter.get("/", asyncHandler(listProjectsHandler));
// Must be registered before "/:id" or Express would match "random" as an id.
projectPublicRouter.get("/random", asyncHandler(randomProjectsHandler));
projectPublicRouter.get("/:id", asyncHandler(getProjectHandler));

export const projectAdminRouter = Router();
projectAdminRouter.post(
  "/",
  requireAdminAuth,
  requirePortfolioAccess,
  upload.fields([{ name: "image", maxCount: 1 }]),
  asyncHandler(createProjectHandler),
);
projectAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  upload.fields([{ name: "image", maxCount: 1 }]),
  asyncHandler(updateProjectHandler),
);
projectAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(deleteProjectHandler),
);
