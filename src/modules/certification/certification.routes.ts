import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createCertificationHandler,
  deleteCertificationHandler,
  listCertificationHandler,
  updateCertificationHandler,
} from "./certification.controller";

export const certificationPublicRouter = Router();
certificationPublicRouter.get("/", asyncHandler(listCertificationHandler));

// Mounted behind requireAdminAuth + portfolio access + resolveOwnPortfolio
// (routes/index.ts), so every request is scoped to the signed-in account's portfolio.
export const certificationAdminRouter = Router();
certificationAdminRouter.post("/", asyncHandler(createCertificationHandler));
certificationAdminRouter.put("/:id", asyncHandler(updateCertificationHandler));
certificationAdminRouter.delete("/:id", asyncHandler(deleteCertificationHandler));
