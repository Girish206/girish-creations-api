import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/httpError";

const includeRelations = {
  category: true,
  paidBy: { select: { id: true, email: true, name: true } },
  savingsGoal: { select: { id: true, name: true } },
  expenseGroup: { select: { id: true, name: true } },
  splitParticipants: {
    include: { adminUser: { select: { id: true, email: true, name: true } } },
  },
} as const;

export interface RequestingAdmin {
  id: bigint;
  isOwner: boolean;
}

// Private by default (only who paid it can see it) — split with others and
// it becomes visible to everyone in that split too. Owner sees everything.
export async function listExpenses(admin: RequestingAdmin) {
  return prisma.expense.findMany({
    where: admin.isOwner
      ? undefined
      : { OR: [{ paidByAdminUserId: admin.id }, { splitParticipants: { some: { adminUserId: admin.id } } }] },
    include: includeRelations,
    orderBy: { date: "desc" },
  });
}

async function assertExpenseAccess(expenseId: bigint, admin: RequestingAdmin) {
  if (admin.isOwner) return;
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { splitParticipants: true },
  });
  if (!expense) return;
  const allowed =
    expense.paidByAdminUserId === admin.id || expense.splitParticipants.some((p) => p.adminUserId === admin.id);
  if (!allowed) {
    throw ForbiddenError("You don't have access to this expense");
  }
}

export interface ExpenseInput {
  amount: string;
  date: string;
  description?: string | null;
  categoryId: bigint;
  paidByAdminUserId: bigint;
  // Which savings pot this was spent from — optional.
  savingsGoalId?: bigint | null;
  // Ad-hoc trip/event bucket (e.g. "Goa Trip 2026") — optional.
  expenseGroupId?: bigint | null;
  // Equal-split participants — undefined leaves existing splits untouched
  // on update, an empty array clears them, a non-empty array replaces them.
  splitAdminUserIds?: bigint[];
}

// Splits `amount` (a decimal string) equally across `adminUserIds`, in
// integer cents, distributing any leftover cent(s) one-by-one to the first
// few participants so the shares always sum to exactly `amount`.
function computeEqualShares(amount: string, adminUserIds: bigint[]): { adminUserId: bigint; shareAmount: string }[] {
  const totalCents = Math.round(Number(amount) * 100);
  const count = adminUserIds.length;
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  return adminUserIds.map((adminUserId, index) => {
    const cents = baseCents + (index < remainder ? 1 : 0);
    return { adminUserId, shareAmount: (cents / 100).toFixed(2) };
  });
}

async function replaceSplitParticipants(expenseId: bigint, amount: string, adminUserIds: bigint[]) {
  await prisma.expenseSplitParticipant.deleteMany({ where: { expenseId } });
  if (adminUserIds.length === 0) return;

  const shares = computeEqualShares(amount, adminUserIds);
  await prisma.expenseSplitParticipant.createMany({
    data: shares.map((share) => ({
      expenseId,
      adminUserId: share.adminUserId,
      shareAmount: share.shareAmount,
    })),
  });
}

export async function createExpense(input: ExpenseInput) {
  const created = await prisma.expense.create({
    data: {
      amount: input.amount,
      date: new Date(input.date),
      description: input.description,
      categoryId: input.categoryId,
      paidByAdminUserId: input.paidByAdminUserId,
      savingsGoalId: input.savingsGoalId ?? null,
      expenseGroupId: input.expenseGroupId ?? null,
    },
  });

  if (input.splitAdminUserIds && input.splitAdminUserIds.length > 0) {
    await replaceSplitParticipants(created.id, input.amount, input.splitAdminUserIds);
  }

  return prisma.expense.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations });
}

export async function updateExpense(id: bigint, input: Partial<ExpenseInput>, admin: RequestingAdmin) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  await assertExpenseAccess(id, admin);

  const updated = await prisma.expense.update({
    where: { id },
    data: {
      amount: input.amount,
      date: input.date ? new Date(input.date) : undefined,
      description: input.description,
      categoryId: input.categoryId,
      paidByAdminUserId: input.paidByAdminUserId,
      savingsGoalId: input.savingsGoalId !== undefined ? input.savingsGoalId : undefined,
      expenseGroupId: input.expenseGroupId !== undefined ? input.expenseGroupId : undefined,
    },
  });

  if (input.splitAdminUserIds !== undefined) {
    await replaceSplitParticipants(id, input.amount ?? updated.amount.toString(), input.splitAdminUserIds);
  }

  return prisma.expense.findUniqueOrThrow({ where: { id }, include: includeRelations });
}

export async function deleteExpense(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  await assertExpenseAccess(id, admin);
  await prisma.expense.delete({ where: { id } });
}
