import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { isSuperAdmin, requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { amountSchema } from "../../utils/money";
import { parseId } from "../../utils/parseId";
import { assertCategoryUsable } from "../expense-category/expense-category.service";

// Monthly limits each person sets on their own spending, one per category.
// Private: everyone sees and changes only their own. How much of a budget is
// used is worked out in the app, from the same per-person share the
// dashboard shows.

const requestingAdmin = (req: Request) => ({ id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) });

async function list(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  const rows = await prisma.categoryBudget.findMany({
    where: { ownerAdminUserId: admin.id },
    orderBy: { createdAt: "asc" },
  });
  res.json({ data: rows });
}

const setSchema = z.object({ amount: amountSchema });

// Sets (or changes) the budget for a category: PUT /:categoryId.
async function set(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  const categoryId = parseId(req.params.categoryId);
  const { amount } = setSchema.parse(req.body);
  await assertCategoryUsable(categoryId, admin);
  const row = await prisma.categoryBudget.upsert({
    where: { ownerAdminUserId_categoryId: { ownerAdminUserId: admin.id, categoryId } },
    create: { ownerAdminUserId: admin.id, categoryId, amount },
    update: { amount },
  });
  res.json({ data: row });
}

async function remove(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  await prisma.categoryBudget.deleteMany({
    where: { ownerAdminUserId: admin.id, categoryId: parseId(req.params.categoryId) },
  });
  res.status(204).send();
}

const access = [requireAdminAuth, requireModuleAccess("expenses")];

export const budgetAdminRouter = Router();
budgetAdminRouter.get("/", ...access, asyncHandler(list));
budgetAdminRouter.put("/:categoryId", ...access, asyncHandler(set));
budgetAdminRouter.delete("/:categoryId", ...access, asyncHandler(remove));
