import type { Request, Response } from "express";
import { z } from "zod";
import { isSuperAdmin } from "../../middleware/auth";
import * as expenseService from "./expense.service";
import { amountSchema, dateSchema, shareAmountSchema } from "../../utils/money";
import { parseId } from "../../utils/parseId";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) };
}

export async function listExpensesHandler(req: Request, res: Response) {
  const items = await expenseService.listExpenses(requestingAdmin(req));
  res.json({ data: items });
}

const expenseSchema = z.object({
  amount: amountSchema,
  date: dateSchema,
  description: z.string().nullable().optional(),
  categoryId: z.coerce.bigint(),
  paidByAdminUserId: z.coerce.bigint().optional(),
  savingsGoalId: z.coerce.bigint().nullable().optional(),
  expenseGroupId: z.coerce.bigint().nullable().optional(),
  splitAdminUserIds: z.array(z.coerce.bigint()).optional(),
  splitShares: z
    .array(z.object({ adminUserId: z.coerce.bigint(), shareAmount: shareAmountSchema }))
    .optional(),
});

export async function createExpenseHandler(req: Request, res: Response) {
  const input = expenseSchema.parse(req.body);
  const paidByAdminUserId = input.paidByAdminUserId ?? BigInt(req.admin!.sub);
  const created = await expenseService.createExpense({ ...input, paidByAdminUserId }, requestingAdmin(req));
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

export async function getDirectBalancesHandler(req: Request, res: Response) {
  const balances = await expenseService.getDirectBalances(requestingAdmin(req));
  res.json({ data: balances });
}

const directSettlementSchema = z.object({
  amount: amountSchema,
  date: dateSchema,
  fromAdminUserId: z.coerce.bigint(),
  toAdminUserId: z.coerce.bigint(),
});

export async function addDirectSettlementHandler(req: Request, res: Response) {
  const input = directSettlementSchema.parse(req.body);
  const balances = await expenseService.addDirectSettlement(input, requestingAdmin(req));
  res.status(201).json({ data: balances });
}

export async function deleteDirectSettlementHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseService.deleteDirectSettlement(id, requestingAdmin(req));
  res.status(204).send();
}
