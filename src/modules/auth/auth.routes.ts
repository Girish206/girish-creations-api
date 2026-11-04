import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAnyAppAuth } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rateLimit";
import { loginHandler, logoutHandler, meHandler, refreshHandler } from "./auth.controller";

export const authRouter = Router();

// Password guessing: per address, and per account typed in.
const loginLimits = [
  asyncHandler(rateLimit("login-ip", 30, 15 * 60_000)),
  asyncHandler(
    rateLimit("login-id", 10, 15 * 60_000, (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200)),
  ),
];

authRouter.post("/login", ...loginLimits, asyncHandler(loginHandler));
authRouter.post("/refresh", requireAnyAppAuth, asyncHandler(refreshHandler));
authRouter.get("/me", requireAnyAppAuth, asyncHandler(meHandler));
authRouter.post("/logout", requireAnyAppAuth, asyncHandler(logoutHandler));
