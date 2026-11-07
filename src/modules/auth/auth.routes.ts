import { Router, type Request } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminToken } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rateLimit";
import { normalizeMobile } from "../../utils/mobile";
import {
  codeLoginHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  requestCodeHandler,
  resetPasswordHandler,
} from "./auth.controller";

export const authRouter = Router();

// Password guessing: per address, and per account typed in.
const loginLimits = [
  asyncHandler(rateLimit("login-ip", 30, 15 * 60_000)),
  asyncHandler(
    rateLimit("login-id", 10, 15 * 60_000, (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200)),
  ),
];

// The same person however they typed it, so a reformatted number isn't a new count.
function identifierKey(req: Request) {
  const typed = String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200);
  return typed.includes("@") ? typed : (normalizeMobile(typed) ?? typed);
}

// Asking for codes sends real email: this protects someone's inbox from being
// flooded, and the email allowance from being used up.
const requestCodeLimits = [
  asyncHandler(rateLimit("code-request-ip", 20, 60 * 60_000)),
  asyncHandler(rateLimit("code-request-id", 5, 15 * 60_000, identifierKey)),
];
// Guessing, on top of the limit each code has on wrong tries.
const useCodeLimits = [
  asyncHandler(rateLimit("code-use-ip", 30, 15 * 60_000)),
  asyncHandler(rateLimit("code-use-id", 15, 15 * 60_000, identifierKey)),
];

authRouter.post("/login", ...loginLimits, asyncHandler(loginHandler));
authRouter.post("/otp/request", ...requestCodeLimits, asyncHandler(requestCodeHandler));
authRouter.post("/otp/login", ...useCodeLimits, asyncHandler(codeLoginHandler));
authRouter.post("/password/reset", ...useCodeLimits, asyncHandler(resetPasswordHandler));
authRouter.post("/refresh", requireAdminToken, asyncHandler(refreshHandler));
authRouter.get("/me", requireAdminToken, asyncHandler(meHandler));
authRouter.post("/logout", requireAdminToken, asyncHandler(logoutHandler));
