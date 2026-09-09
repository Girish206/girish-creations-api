import { prisma } from "../../lib/prisma";
import { ConflictError, NotFoundError } from "../../utils/httpError";

export async function listExpenseCategories() {
  return prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
}

export async function createExpenseCategory(name: string) {
  const existing = await prisma.expenseCategory.findUnique({ where: { name } });
  if (existing) {
    throw ConflictError("A category with this name already exists");
  }
  return prisma.expenseCategory.create({ data: { name } });
}

export async function updateExpenseCategory(id: bigint, name: string) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Category not found");
  }
  return prisma.expenseCategory.update({ where: { id }, data: { name } });
}

export async function deleteExpenseCategory(id: bigint) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Category not found");
  }
  await prisma.expenseCategory.delete({ where: { id } });
}
