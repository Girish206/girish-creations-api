import type { Request, Response } from "express";
import { z } from "zod";
import * as expenseGroupService from "./expense-group.service";
import { parseId } from "../../utils/parseId";

export async function listExpenseGroupsHandler(_req: Request, res: Response) {
  const items = await expenseGroupService.listExpenseGroups();
  res.json({ data: items });
}

const groupSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export async function createExpenseGroupHandler(req: Request, res: Response) {
  const input = groupSchema.parse(req.body);
  const created = await expenseGroupService.createExpenseGroup(input);
  res.status(201).json({ data: created });
}

export async function updateExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = groupSchema.partial().parse(req.body);
  const updated = await expenseGroupService.updateExpenseGroup(id, input);
  res.json({ data: updated });
}

export async function deleteExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseGroupService.deleteExpenseGroup(id);
  res.status(204).send();
}

const closeSchema = z.object({ closed: z.boolean() });

export async function setExpenseGroupClosedHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { closed } = closeSchema.parse(req.body);
  const updated = await expenseGroupService.setExpenseGroupClosed(id, closed);
  res.json({ data: updated });
}

const settlementSchema = z.object({
  amount: z.coerce.string().min(1),
  date: z.string(),
  fromAdminUserId: z.coerce.bigint(),
  toAdminUserId: z.coerce.bigint(),
});

export async function addSettlementHandler(req: Request, res: Response) {
  const groupId = parseId(req.params.id);
  const input = settlementSchema.parse(req.body);
  const updated = await expenseGroupService.addSettlement(groupId, input);
  res.status(201).json({ data: updated });
}

export async function deleteSettlementHandler(req: Request, res: Response) {
  const groupId = parseId(req.params.id);
  const settlementId = parseId(req.params.settlementId);
  await expenseGroupService.deleteSettlement(groupId, settlementId);
  res.status(204).send();
}
