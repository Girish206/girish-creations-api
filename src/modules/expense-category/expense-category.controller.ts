import type { Request, Response } from "express";
import { z } from "zod";
import * as expenseCategoryService from "./expense-category.service";
import { parseId } from "../../utils/parseId";

export async function listExpenseCategoriesHandler(_req: Request, res: Response) {
  const items = await expenseCategoryService.listExpenseCategories();
  res.json({ data: items });
}

const categorySchema = z.object({ name: z.string().min(1) });

export async function createExpenseCategoryHandler(req: Request, res: Response) {
  const { name } = categorySchema.parse(req.body);
  const created = await expenseCategoryService.createExpenseCategory(name);
  res.status(201).json({ data: created });
}

export async function updateExpenseCategoryHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const { name } = categorySchema.parse(req.body);
  const updated = await expenseCategoryService.updateExpenseCategory(id, name);
  res.json({ data: updated });
}

export async function deleteExpenseCategoryHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseCategoryService.deleteExpenseCategory(id);
  res.status(204).send();
}
