import type { Request, Response } from "express";
import { z } from "zod";
import * as expenseService from "./expense.service";
import { parseId } from "../../utils/parseId";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isOwner: req.admin!.isOwner };
}

export async function listExpensesHandler(req: Request, res: Response) {
  const items = await expenseService.listExpenses(requestingAdmin(req));
  res.json({ data: items });
}

const expenseSchema = z.object({
  amount: z.coerce.string().min(1),
  date: z.string(),
  description: z.string().nullable().optional(),
  categoryId: z.coerce.bigint(),
  paidByAdminUserId: z.coerce.bigint().optional(),
  savingsGoalId: z.coerce.bigint().nullable().optional(),
  expenseGroupId: z.coerce.bigint().nullable().optional(),
  splitAdminUserIds: z.array(z.coerce.bigint()).optional(),
});

export async function createExpenseHandler(req: Request, res: Response) {
  const input = expenseSchema.parse(req.body);
  const paidByAdminUserId = input.paidByAdminUserId ?? BigInt(req.admin!.sub);
  const created = await expenseService.createExpense({ ...input, paidByAdminUserId });
  res.status(201).json({ data: created });
}

export async function updateExpenseHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = expenseSchema.partial().parse(req.body);
  const updated = await expenseService.updateExpense(id, input, requestingAdmin(req));
  res.json({ data: updated });
}

export async function deleteExpenseHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseService.deleteExpense(id, requestingAdmin(req));
  res.status(204).send();
}
