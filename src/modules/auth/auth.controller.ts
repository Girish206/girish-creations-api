import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";
import * as otpService from "./auth-otp.service";

// `email` holds whatever the user typed: an email address or a mobile number.
// `remember` asks for a long-lived "keep me signed in" session.
const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export async function loginHandler(req: Request, res: Response) {
  const { email: identifier, password, remember } = loginSchema.parse(req.body);
  const { token, admin } = await authService.login(identifier, password, remember);
  res.json({ data: { token, admin } });
}

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const requestCodeSchema = z.object({
  email: z.string().trim().min(1),
  purpose: z.enum(["login", "reset"]),
});

export async function requestCodeHandler(req: Request, res: Response) {
  const { email: identifier, purpose } = requestCodeSchema.parse(req.body);
  res.json({ data: await otpService.requestCode(identifier, purpose) });
}

const codeLoginSchema = z.object({
  email: z.string().trim().min(1),
  code: codeSchema,
  remember: z.boolean().optional(),
});

export async function codeLoginHandler(req: Request, res: Response) {
  const { email: identifier, code, remember } = codeLoginSchema.parse(req.body);
  res.json({ data: await otpService.loginWithCode(identifier, code, remember) });
}

const resetPasswordSchema = codeLoginSchema.extend({
  // Same minimum as everywhere else a password is set.
  newPassword: z.string().min(8),
});

export async function resetPasswordHandler(req: Request, res: Response) {
  const { email: identifier, code, newPassword, remember } = resetPasswordSchema.parse(req.body);
  res.json({ data: await otpService.resetPassword(identifier, code, newPassword, remember) });
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
