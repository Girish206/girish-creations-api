import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "./auth.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginHandler(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const { token, admin } = await authService.login(email, password);
  res.json({ data: { token, admin } });
}

export async function meHandler(req: Request, res: Response) {
  res.json({ data: req.admin });
}

export async function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
