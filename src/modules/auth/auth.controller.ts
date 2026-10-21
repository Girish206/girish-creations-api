import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";

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

export async function refreshHandler(req: Request, res: Response) {
  const { remember } = z.object({ remember: z.boolean().optional() }).parse(req.body ?? {});
  const { token, admin } = await authService.refresh(req.admin!, remember);
  res.json({ data: { token, admin } });
}

export async function meHandler(req: Request, res: Response) {
  res.json({ data: req.admin });
}

export async function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
