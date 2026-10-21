import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";

// `email` holds whatever the user typed: an email address or a mobile number.
const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function loginHandler(req: Request, res: Response) {
  const { email: identifier, password } = loginSchema.parse(req.body);
  const { token, admin } = await authService.login(identifier, password);
  res.json({ data: { token, admin } });
}

export async function meHandler(req: Request, res: Response) {
  res.json({ data: req.admin });
}

export async function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
