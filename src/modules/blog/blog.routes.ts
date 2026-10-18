import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  listBlogHandler,
  getBlogHandler,
  createBlogHandler,
  updateBlogHandler,
  deleteBlogHandler,
} from "./blog.controller";

export const blogPublicRouter = Router();
blogPublicRouter.get("/", asyncHandler(listBlogHandler));
blogPublicRouter.get("/:slug", asyncHandler(getBlogHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const blogAdminRouter = Router();
blogAdminRouter.post("/", asyncHandler(createBlogHandler));
blogAdminRouter.put("/:id", asyncHandler(updateBlogHandler));
blogAdminRouter.delete("/:id", asyncHandler(deleteBlogHandler));
