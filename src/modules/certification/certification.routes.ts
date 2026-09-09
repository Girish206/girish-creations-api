import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import {
  createCertificationHandler,
  deleteCertificationHandler,
  listCertificationHandler,
  updateCertificationHandler,
} from "./certification.controller";

const requirePortfolioAccess = requireModuleAccess("portfolio");

export const certificationPublicRouter = Router();
certificationPublicRouter.get("/", asyncHandler(listCertificationHandler));

export const certificationAdminRouter = Router();
certificationAdminRouter.post(
  "/",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(createCertificationHandler),
);
certificationAdminRouter.put(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(updateCertificationHandler),
);
certificationAdminRouter.delete(
  "/:id",
  requireAdminAuth,
  requirePortfolioAccess,
  asyncHandler(deleteCertificationHandler),
);
