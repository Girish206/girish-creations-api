import type { Request, Response } from "express";
import { z } from "zod";
import * as expenseGroupService from "./expense-group.service";
import { parseId } from "../../utils/parseId";

export async function listExpenseGroupsHandler(_req: Request, res: Response) {
  const items = await expenseGroupService.listExpenseGroups();
  res.json({ data: items });
}

const groupSchema = z.object({ name: z.string().min(1) });

export async function createExpenseGroupHandler(req: Request, res: Response) {
  const { name } = groupSchema.parse(req.body);
  const created = await expenseGroupService.createExpenseGroup(name);
  res.status(201).json({ data: created });
}

export async function updateExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { name } = groupSchema.parse(req.body);
  const updated = await expenseGroupService.updateExpenseGroup(id, name);
  res.json({ data: updated });
}

export async function deleteExpenseGroupHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseGroupService.deleteExpenseGroup(id);
  res.status(204).send();
}
