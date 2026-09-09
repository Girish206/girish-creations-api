import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";

export async function listExpenseGroups() {
  return prisma.expenseGroup.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createExpenseGroup(name: string) {
  return prisma.expenseGroup.create({ data: { name } });
}

export async function updateExpenseGroup(id: bigint, name: string) {
  const existing = await prisma.expenseGroup.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Trip/event not found");
  }
  return prisma.expenseGroup.update({ where: { id }, data: { name } });
}

export async function deleteExpenseGroup(id: bigint) {
  const existing = await prisma.expenseGroup.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Trip/event not found");
  }
  // Expenses in this group aren't deleted — they just lose the grouping.
  await prisma.expense.updateMany({ where: { expenseGroupId: id }, data: { expenseGroupId: null } });
  await prisma.expenseGroup.delete({ where: { id } });
}
