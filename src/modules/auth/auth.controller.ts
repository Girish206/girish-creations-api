import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";
import * as otpService from "./auth-otp.service";

// `email` holds whatever the user typed: an email address or a mobile number.
// `remember` asks for a long-lived "keep me signed in" session. `app` is the
// app the session will work on.
const loginSchema = z.object({
  app: z.enum(["admin", "cricket"]).default("admin"),
  email: z.string().trim().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export async function loginHandler(req: Request, res: Response) {
  const { email: identifier, password, remember, app } = loginSchema.parse(req.body);
  const { token, admin } = await authService.login(identifier, password, app, remember);
  res.json({ data: { token, admin } });
}

const appSchema = z.enum(["admin", "cricket"]).default("admin");
const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const requestCodeSchema = z.object({
  app: appSchema,
  email: z.string().trim().min(1),
  purpose: z.enum(["login", "reset"]),
});

export async function requestCodeHandler(req: Request, res: Response) {
  const { email: identifier, purpose, app } = requestCodeSchema.parse(req.body);
  res.json({ data: await otpService.requestCode(identifier, purpose, app) });
}

const codeLoginSchema = z.object({
  app: appSchema,
  email: z.string().trim().min(1),
  code: codeSchema,
  remember: z.boolean().optional(),
});

export async function codeLoginHandler(req: Request, res: Response) {
  const { email: identifier, code, app, remember } = codeLoginSchema.parse(req.body);
  res.json({ data: await otpService.loginWithCode(identifier, code, app, remember) });
}

const resetPasswordSchema = codeLoginSchema.extend({
  // Same minimum as everywhere else a password is set.
  newPassword: z.string().min(8),
});

export async function resetPasswordHandler(req: Request, res: Response) {
  const { email: identifier, code, newPassword, app, remember } = resetPasswordSchema.parse(req.body);
  res.json({ data: await otpService.resetPassword(identifier, code, newPassword, app, remember) });
}

export async function refreshHandler(req: Request, res: Response) {
  const { remember } = z.object({ remember: z.boolean().optional() }).parse(req.body ?? {});
  const { token, admin } = await authService.refresh(req.admin!, remember);
  res.json({ data: { token, admin } });
}

export async function meHandler(req: Request, res: Response) {
  res.json({ data: req.admin });
}

// Signing out drops the token on the device; `everywhere` also ends every
// other session of the account.
export async function logoutHandler(req: Request, res: Response) {
  const { everywhere } = z.object({ everywhere: z.boolean().optional() }).parse(req.body ?? {});
  if (everywhere) await authService.signOutEverywhere(BigInt(req.admin!.sub));
  res.status(204).send();
}
