import type { Request, Response } from "express";
import { z } from "zod";
import * as adminUserService from "./admin-user.service";
import { parseId } from "../../utils/parseId";
import { isSuperAdmin } from "../../middleware/auth";
import { mobileSchema } from "../../utils/mobile";

export async function listAdminUsersHandler(req: Request, res: Response) {
  const items = await adminUserService.listAdminUsers(actingAdmin(req));
  res.json({ data: items });
}

export async function listExpenseMembersHandler(_req: Request, res: Response) {
  const items = await adminUserService.listExpenseMembers();
  res.json({ data: items });
}

// Emails are stored trimmed and lowercased (login normalises the same way),
// so "Ravi@Gmail.com " from a phone keyboard still signs in as typed.
const emailSchema = z.string().trim().toLowerCase().email();

const createSchema = z.object({
  // Omit email, mobile and password for a guest member (listed but can't
  // log in). Login needs a password plus an email or a mobile number.
  email: emailSchema.nullable().optional(),
  mobile: mobileSchema.nullable().optional(),
  password: z.string().min(8).nullable().optional(),
  name: z.string().nullable().optional(),
  hasPortfolioAccess: z.boolean().default(false),
  hasExpensesAccess: z.boolean().default(false),
  hasSavingsAccess: z.boolean().default(false),
  hasCricketAccess: z.boolean().default(false),
  isSuperAdmin: z.boolean().default(false),
});

// Who is making an account change — the service limits what a non-owner
// super admin may do.
function actingAdmin(req: Request): adminUserService.ActingAdmin {
  const admin = req.admin!;
  return {
    id: BigInt(admin.sub),
    isOwner: admin.isOwner,
    isSuperAdmin: isSuperAdmin(admin),
    hasExpensesAccess: admin.hasExpensesAccess,
    hasSavingsAccess: admin.hasSavingsAccess,
  };
}

export async function createAdminUserHandler(req: Request, res: Response) {
  const input = createSchema.parse(req.body);
  const created = await adminUserService.createAdminUser(input, actingAdmin(req));
  res.status(201).json({ data: created });
}

const updateSchema = z.object({
  name: z.string().nullable().optional(),
  // Setting email (+ password, for a guest) grants/changes login access.
  email: emailSchema.optional(),
  // null clears it.
  mobile: mobileSchema.nullable().optional(),
  password: z.string().min(8).optional(),
  removeLogin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  hasPortfolioAccess: z.boolean().optional(),
  hasExpensesAccess: z.boolean().optional(),
  hasSavingsAccess: z.boolean().optional(),
  hasCricketAccess: z.boolean().optional(),
  isSuperAdmin: z.boolean().optional(),
});

export async function updateAdminUserHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = updateSchema.parse(req.body);
  const updated = await adminUserService.updateAdminUser(id, input, actingAdmin(req));
  res.json({ data: updated });
}

export async function deleteAdminUserHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  // ?permanent=true removes the row (only allowed with no linked records);
  // the default just deactivates.
  await adminUserService.deleteAdminUser(id, actingAdmin(req), req.query.permanent === "true");
  res.status(204).send();
}
