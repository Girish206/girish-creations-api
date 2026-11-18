import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";
import { deleteUploadedFile } from "../../middleware/upload";

export interface ExpenseCategoryInput {
  name: string;
  iconType?: string;
  icon?: string | null;
}

// "Food" and "food " are the same category to people picking one, so names
// are matched ignoring case and spacing.
function sameName(name: string) {
  return { name: { equals: name.trim(), mode: "insensitive" as const } };
}

export async function listExpenseCategories() {
  return prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
}

export async function createExpenseCategory(input: ExpenseCategoryInput) {
  const existing = await prisma.expenseCategory.findFirst({ where: sameName(input.name) });
  if (existing) {
    throw ConflictError(`"${existing.name}" already exists — use that one`);
  }
  return prisma.expenseCategory.create({ data: input });
}

export async function updateExpenseCategory(id: bigint, input: ExpenseCategoryInput) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Category not found");
  }
  const clash = await prisma.expenseCategory.findFirst({ where: { ...sameName(input.name), id: { not: id } } });
  if (clash) {
    throw ConflictError(`"${clash.name}" already exists — merge into it instead`);
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
  // Counted across everyone's expenses, not just the requester's visible ones.
  const expenses = await prisma.expense.count({ where: { categoryId: id } });
  if (expenses > 0) {
    throw ConflictError(
      `${expenses} expense${expenses === 1 ? " uses" : "s use"} this category — move ${expenses === 1 ? "it" : "them"} to another category first`,
    );
  }
  await prisma.expenseCategory.delete({ where: { id } });
  await deleteUploadedFile(existing.icon);
}

// Folds a duplicate into the category to keep: its expenses move across and
// it's removed. Returns how many expenses moved.
export async function mergeExpenseCategory(id: bigint, intoId: bigint) {
  if (id === intoId) {
    throw BadRequestError("Pick a different category to merge into");
  }
  const [source, target] = await Promise.all([
    prisma.expenseCategory.findUnique({ where: { id } }),
    prisma.expenseCategory.findUnique({ where: { id: intoId } }),
  ]);
  if (!source || !target) {
    throw NotFoundError("Category not found");
  }
  const { count } = await prisma.expense.updateMany({ where: { categoryId: id }, data: { categoryId: intoId } });
  await prisma.expenseCategory.delete({ where: { id } });
  await deleteUploadedFile(source.icon);
  return { moved: count, into: target };
}
