import { prisma } from "../../lib/prisma";
import { ConflictError, NotFoundError } from "../../utils/httpError";
import { deleteUploadedFile } from "../../middleware/upload";

export interface ExpenseCategoryInput {
  name: string;
  iconType?: string;
  icon?: string | null;
}

export async function listExpenseCategories() {
  return prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
}

export async function createExpenseCategory(input: ExpenseCategoryInput) {
  const existing = await prisma.expenseCategory.findUnique({ where: { name: input.name } });
  if (existing) {
    throw ConflictError("A category with this name already exists");
  }
  return prisma.expenseCategory.create({ data: input });
}

export async function updateExpenseCategory(id: bigint, input: ExpenseCategoryInput) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Category not found");
  }
  const clash = await prisma.expenseCategory.findUnique({ where: { name: input.name } });
  if (clash && clash.id !== id) {
    throw ConflictError("A category with this name already exists");
  }
  const updated = await prisma.expenseCategory.update({ where: { id }, data: input });
  // Drop the old uploaded image once it's been replaced or switched away from.
  if (input.iconType !== undefined && existing.icon !== updated.icon) {
    await deleteUploadedFile(existing.icon);
  }
  return updated;
}

export async function deleteExpenseCategory(id: bigint) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Category not found");
  }
  await prisma.expenseCategory.delete({ where: { id } });
  await deleteUploadedFile(existing.icon);
}
