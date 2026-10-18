import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { upload } from "../../middleware/upload";
import {
  listProjectsHandler,
  randomProjectsHandler,
  getProjectHandler,
  createProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
} from "./project.controller";

export const projectPublicRouter = Router();
projectPublicRouter.get("/", asyncHandler(listProjectsHandler));
// Must be registered before "/:id" or Express would match "random" as an id.
projectPublicRouter.get("/random", asyncHandler(randomProjectsHandler));
projectPublicRouter.get("/:id", asyncHandler(getProjectHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const projectAdminRouter = Router();
projectAdminRouter.post("/", upload.fields([{ name: "image", maxCount: 1 }]), asyncHandler(createProjectHandler));
projectAdminRouter.put("/:id", upload.fields([{ name: "image", maxCount: 1 }]), asyncHandler(updateProjectHandler));
projectAdminRouter.delete("/:id", asyncHandler(deleteProjectHandler));
