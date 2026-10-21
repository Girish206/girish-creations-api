import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth } from "../../middleware/auth";
import { loginHandler, logoutHandler, meHandler, refreshHandler } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(loginHandler));
authRouter.post("/refresh", requireAdminAuth, asyncHandler(refreshHandler));
authRouter.get("/me", requireAdminAuth, asyncHandler(meHandler));
authRouter.post("/logout", requireAdminAuth, asyncHandler(logoutHandler));
