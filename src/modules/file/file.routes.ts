import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { getFileHandler } from "./file.controller";

export const filePublicRouter = Router();
filePublicRouter.get("/:id", asyncHandler(getFileHandler));
