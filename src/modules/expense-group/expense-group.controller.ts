import type { Request, Response } from "express";
import { z } from "zod";
import { isSuperAdmin } from "../../middleware/auth";
import * as expenseGroupService from "./expense-group.service";
import { listGroupExpenses } from "../expense/expense.service";
import { amountSchema, dateSchema } from "../../utils/money";
import { parseId } from "../../utils/parseId";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) };
}

export async function listExpenseGroupsHandler(req: Request, res: Response) {
  const items = await expenseGroupService.listExpenseGroups(requestingAdmin(req));
  res.json({ data: items });
}

const groupSchema = z.object({
  name: z.string().trim().min(1),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  memberAdminUserIds: z.array(z.coerce.bigint()).optional(),
});

export async function createExpenseGroupHandler(req: Request, res: Response) {
  const input = groupSchema.parse(req.body);
  const created = await expenseGroupService.createExpenseGroup(input, requestingAdmin(req));
  res.status(201).json({ data: created });
}

export async function updateExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = groupSchema.partial().parse(req.body);
  const updated = await expenseGroupService.updateExpenseGroup(id, input, requestingAdmin(req));
  res.json({ data: updated });
}

export async function deleteExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseGroupService.deleteExpenseGroup(id, requestingAdmin(req));
  res.status(204).send();
}

const closeSchema = z.object({ closed: z.boolean() });

export async function setExpenseGroupClosedHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { closed } = closeSchema.parse(req.body);
  const updated = await expenseGroupService.setExpenseGroupClosed(id, closed, requestingAdmin(req));
  res.json({ data: updated });
}

const settlementSchema = z.object({
  amount: amountSchema,
  date: dateSchema,
  fromAdminUserId: z.coerce.bigint(),
  toAdminUserId: z.coerce.bigint(),
});

export async function addSettlementHandler(req: Request, res: Response) {
  const groupId = parseId(req.params.id);
  const input = settlementSchema.parse(req.body);
  const updated = await expenseGroupService.addSettlement(groupId, input, requestingAdmin(req));
  res.status(201).json({ data: updated });
}

export async function deleteSettlementHandler(req: Request, res: Response) {
  const groupId = parseId(req.params.id);
  const settlementId = parseId(req.params.settlementId);
  await expenseGroupService.deleteSettlement(groupId, settlementId, requestingAdmin(req));
  res.status(204).send();
}

export async function listGroupExpensesHandler(req: Request, res: Response) {
  const items = await listGroupExpenses(parseId(req.params.id), requestingAdmin(req));
  res.json({ data: items });
}
