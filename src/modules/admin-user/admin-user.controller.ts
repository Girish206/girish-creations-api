import type { Request, Response } from "express";
import { z } from "zod";
import * as adminUserService from "./admin-user.service";
import { parseId } from "../../utils/parseId";

export async function listAdminUsersHandler(_req: Request, res: Response) {
  const items = await adminUserService.listAdminUsers();
  res.json({ data: items });
}

export async function listExpenseMembersHandler(_req: Request, res: Response) {
  const items = await adminUserService.listExpenseMembers();
  res.json({ data: items });
}

const createSchema = z.object({
  // Omit both for a guest member (listed but can't log in).
  email: z.string().email().nullable().optional(),
  password: z.string().min(8).nullable().optional(),
  name: z.string().nullable().optional(),
  hasPortfolioAccess: z.boolean().default(false),
  hasExpensesAccess: z.boolean().default(false),
  hasInvestmentsAccess: z.boolean().default(false),
  hasSavingsAccess: z.boolean().default(false),
});

export async function createAdminUserHandler(req: Request, res: Response) {
  const input = createSchema.parse(req.body);
  const created = await adminUserService.createAdminUser(input);
  res.status(201).json({ data: created });
}

const updateSchema = z.object({
  name: z.string().nullable().optional(),
  // Setting email (+ password, for a guest) grants/changes login access.
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
  hasPortfolioAccess: z.boolean().optional(),
  hasExpensesAccess: z.boolean().optional(),
  hasInvestmentsAccess: z.boolean().optional(),
  hasSavingsAccess: z.boolean().optional(),
});

export async function updateAdminUserHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = updateSchema.parse(req.body);
  const updated = await adminUserService.updateAdminUser(id, input);
  res.json({ data: updated });
}

export async function deleteAdminUserHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await adminUserService.deleteAdminUser(id);
  res.status(204).send();
}
