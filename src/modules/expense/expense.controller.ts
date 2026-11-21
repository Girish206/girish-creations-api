import type { Request, Response } from "express";
import { z } from "zod";
import { isSuperAdmin } from "../../middleware/auth";
import * as expenseService from "./expense.service";
import { amountSchema, dateSchema, shareAmountSchema } from "../../utils/money";
import { parseId } from "../../utils/parseId";
import { runDueRecurring } from "../recurring/recurring.service";
import { toRupees, type ForeignAmount } from "./foreign-currency";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) };
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const rangeSchema = z.object({
  from: z.string().regex(dayPattern).optional(),
  to: z.string().regex(dayPattern).optional(),
});

// ?from=YYYY-MM-DD&to=YYYY-MM-DD limits it to those dates (both optional).
// Anything recurring that's due is added first, so it's in the list.
export async function listExpensesHandler(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  await runDueRecurring(admin);
  const items = await expenseService.listExpenses(admin, rangeSchema.parse(req.query));
  res.json({ data: items });
}

export async function listExpenseMonthsHandler(req: Request, res: Response) {
  const admin = requestingAdmin(req);
  await runDueRecurring(admin);
  res.json({ data: await expenseService.listExpenseMonths(admin) });
}

export async function getExpenseHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  res.json({ data: await expenseService.getExpense(id, requestingAdmin(req)) });
}

// Paid in another currency: the rupee amount is worked out from the foreign
// amount and rate (and replaces whatever amount was sent). An empty or "INR"
// currency means rupees, clearing any foreign amount.
function withForeign<T extends { amount?: string; originalCurrency?: string | null; originalAmount?: string | null; exchangeRate?: string | null }>(
  input: T,
): Omit<T, "originalCurrency" | "originalAmount" | "exchangeRate"> & { foreign?: ForeignAmount | null } {
  const { originalCurrency, originalAmount, exchangeRate, ...rest } = input;
  if (originalCurrency === undefined) return rest;
  if (!originalCurrency || originalCurrency.toUpperCase() === "INR") return { ...rest, foreign: null };
  const { amount, foreign } = toRupees({ originalCurrency, originalAmount, exchangeRate });
  return { ...rest, amount, foreign };
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
  originalCurrency: z.string().trim().max(3).nullable().optional(),
  originalAmount: z.coerce.string().trim().nullable().optional(),
  exchangeRate: z.coerce.string().trim().nullable().optional(),
});

export async function createExpenseHandler(req: Request, res: Response) {
  const input = withForeign(expenseSchema.parse(req.body));
  const paidByAdminUserId = input.paidByAdminUserId ?? BigInt(req.admin!.sub);
  const created = await expenseService.createExpense(
    { ...input, foreign: input.foreign ?? null, paidByAdminUserId },
    requestingAdmin(req),
  );
  res.status(201).json({ data: created });
}

export async function updateExpenseHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = withForeign(expenseSchema.partial().parse(req.body));
  const updated = await expenseService.updateExpense(id, input, requestingAdmin(req));
  res.json({ data: updated });
}

export async function deleteExpenseHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseService.deleteExpense(id, requestingAdmin(req));
  res.status(204).send();
}

const disputeSchema = z.object({
  disputed: z.boolean(),
  note: z.string().trim().max(300).nullable().optional(),
});

export async function setExpenseDisputeHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { disputed, note } = disputeSchema.parse(req.body);
  const updated = await expenseService.setExpenseDispute(id, disputed, note, requestingAdmin(req));
  res.json({ data: updated });
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

const reminderSchema = z.object({ fromAdminUserId: z.coerce.bigint(), toAdminUserId: z.coerce.bigint() });

export async function remindDirectDebtHandler(req: Request, res: Response) {
  await expenseService.remindDirectDebt(reminderSchema.parse(req.body), requestingAdmin(req));
  res.status(204).send();
}

export async function deleteDirectSettlementHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseService.deleteDirectSettlement(id, requestingAdmin(req));
  res.status(204).send();
}
