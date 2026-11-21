import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { isSuperAdmin, requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { amountSchema } from "../../utils/money";
import { parseId } from "../../utils/parseId";
import * as recurringService from "./recurring.service";

const requestingAdmin = (req: Request) => ({ id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

const recurringSchema = z.object({
  amount: amountSchema,
  description: z.string().trim().max(200).nullable().optional(),
  categoryId: z.coerce.bigint(),
  frequency: z.enum(["monthly", "weekly"]),
  startDate: day,
  endDate: day.nullable().optional(),
  splitAdminUserIds: z.array(z.coerce.bigint()).optional(),
  active: z.boolean().optional(),
});

async function list(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  await recurringService.runDueRecurring(admin);
  res.json({ data: await recurringService.listRecurring(admin) });
}

async function create(req: Request, res: Response) {
  const input = recurringSchema.parse(req.body);
  res.status(201).json({ data: await recurringService.createRecurring(input, requestingAdmin(req)) });
}

async function update(req: Request, res: Response) {
  const input = recurringSchema.partial().parse(req.body);
  res.json({ data: await recurringService.updateRecurring(parseId(req.params.id), input, requestingAdmin(req)) });
}

async function remove(req: Request, res: Response) {
  await recurringService.deleteRecurring(parseId(req.params.id), requestingAdmin(req));
  res.status(204).send();
}

const access = [requireAdminAuth, requireModuleAccess("expenses")];

export const recurringAdminRouter = Router();
recurringAdminRouter.get("/", ...access, asyncHandler(list));
recurringAdminRouter.post("/", ...access, asyncHandler(create));
recurringAdminRouter.put("/:id", ...access, asyncHandler(update));
recurringAdminRouter.delete("/:id", ...access, asyncHandler(remove));
