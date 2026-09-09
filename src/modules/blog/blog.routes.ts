import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  listBlogHandler,
  getBlogHandler,
  createBlogHandler,
  updateBlogHandler,
  deleteBlogHandler,
} from "./blog.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const blogPublicRouter = Router();
blogPublicRouter.get("/", asyncHandler(listBlogHandler));
blogPublicRouter.get("/:slug", asyncHandler(getBlogHandler));

export const blogAdminRouter = Router();
blogAdminRouter.post("/", requireAdminAuth, requirePortfolioAccess, asyncHandler(createBlogHandler));
blogAdminRouter.put("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(updateBlogHandler));
blogAdminRouter.delete("/:id", requireAdminAuth, requirePortfolioAccess, asyncHandler(deleteBlogHandler));
