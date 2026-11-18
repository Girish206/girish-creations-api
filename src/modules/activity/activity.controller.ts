import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { isSuperAdmin } from "../../middleware/auth";
import { canSeeExpense } from "../expense/expense.service";
import { assertGroupAccess } from "../expense-group/expense-group.service";
import { assertGoalAccess } from "../savings-goal/savings-goal.service";
import * as activityService from "./activity.service";

const querySchema = z.object({
  expenseId: z.coerce.bigint().optional(),
  expenseGroupId: z.coerce.bigint().optional(),
  savingsGoalId: z.coerce.bigint().optional(),
  area: z.enum(["expenses", "savings", "daily"]).optional(),
  limit: z.coerce.number().int().optional(),
});

// A record's whole history goes to whoever sees that record in full: the
// people in a group, anyone who sees a goal, anyone who sees an expense.
// Otherwise (a page's history, or a group seen only through one's own
// expense) it's what each person did or was part of.
async function seesWholeHistory(filter: z.infer<typeof querySchema>, admin: { id: bigint; isSuperAdmin: boolean }) {
  if (admin.isSuperAdmin) return true;
  if (filter.expenseId) return canSeeExpense(filter.expenseId, admin);
  if (filter.expenseGroupId) {
    await assertGroupAccess(filter.expenseGroupId, admin);
    const member = await prisma.expenseGroupMember.count({
      where: { expenseGroupId: filter.expenseGroupId, adminUserId: admin.id },
    });
    return member > 0;
  }
  if (filter.savingsGoalId) {
    await assertGoalAccess(filter.savingsGoalId, admin);
    return true;
  }
  return false;
}

export async function listActivityHandler(req: Request, res: Response) {
  const filter = querySchema.parse(req.query);
  const admin = { id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) };
  const items = await activityService.listActivity(admin, filter, await seesWholeHistory(filter, admin));
  res.json({ data: items });
}
