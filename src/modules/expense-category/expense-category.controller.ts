import type { Request, Response } from "express";
import { z } from "zod";
import * as expenseCategoryService from "./expense-category.service";
import { parseId } from "../../utils/parseId";
import { uploadFile } from "../../middleware/upload";

export async function listExpenseCategoriesHandler(_req: Request, res: Response) {
  const items = await expenseCategoryService.listExpenseCategories();
  res.json({ data: items });
}

// Sent as multipart (so an image can ride along); an "image" category with a
// new file gets that file's URL as its icon, otherwise `icon` is kept as sent
// (a Font Awesome class, a short text label, or the existing image URL).
const categorySchema = z.object({
  name: z.string().trim().min(1),
  iconType: z.enum(["icon", "text", "image"]).optional(),
  icon: z.string().trim().max(500).optional(),
});

async function parseCategoryInput(req: Request) {
  const { name, iconType, icon } = categorySchema.parse(req.body);
  if (!iconType) return { name };
  if (iconType === "image" && req.file) {
    return { name, iconType, icon: await uploadFile(req.file) };
  }
  return { name, iconType, icon: icon || null };
}

export async function createExpenseCategoryHandler(req: Request, res: Response) {
  const created = await expenseCategoryService.createExpenseCategory(await parseCategoryInput(req));
  res.status(201).json({ data: created });
}

export async function updateExpenseCategoryHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const updated = await expenseCategoryService.updateExpenseCategory(id, await parseCategoryInput(req));
  res.json({ data: updated });
}

export async function deleteExpenseCategoryHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await expenseCategoryService.deleteExpenseCategory(id);
  res.status(204).send();
}
