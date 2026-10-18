import { prisma } from "../../lib/prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/httpError";

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
  isSuperAdmin: boolean;
}

// Private by default (only who paid it, and who logged it, can see it) —
// split with others and it becomes visible to everyone in that split too.
// Super admins see everything.
export async function listExpenses(admin: RequestingAdmin) {
  return prisma.expense.findMany({
    where: admin.isSuperAdmin
      ? undefined
      : {
          OR: [
            { paidByAdminUserId: admin.id },
            { createdByAdminUserId: admin.id },
            { splitParticipants: { some: { adminUserId: admin.id } } },
          ],
        },
    include: includeRelations,
    orderBy: { date: "desc" },
  });
}

async function assertExpenseAccess(expenseId: bigint, admin: RequestingAdmin) {
  if (admin.isSuperAdmin) return;
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { splitParticipants: true },
  });
  if (!expense) return;
  const allowed =
    expense.paidByAdminUserId === admin.id ||
    expense.createdByAdminUserId === admin.id ||
    expense.splitParticipants.some((p) => p.adminUserId === admin.id);
  if (!allowed) {
    throw ForbiddenError("You don't have access to this expense");
  }
}

// A closed trip/event group is settled — its expenses are frozen so the
// settle-up balances can't silently change underneath everyone.
async function assertGroupOpen(expenseGroupId: bigint | null | undefined) {
  if (!expenseGroupId) return;
  const group = await prisma.expenseGroup.findUnique({ where: { id: expenseGroupId } });
  if (group?.closedAt) {
    throw BadRequestError(`"${group.name}" is closed — reopen it to change its expenses`);
  }
}

const formatDay = (date: Date) =>
  date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// A group with a start/end date only accepts expenses dated inside that
// window (inclusive). Compared as YYYY-MM-DD so time zones can't shift it.
async function assertDateInGroupWindow(expenseGroupId: bigint | null | undefined, date: Date) {
  if (!expenseGroupId) return;
  const group = await prisma.expenseGroup.findUnique({ where: { id: expenseGroupId } });
  if (!group) return;
  const day = date.toISOString().slice(0, 10);
  const start = group.startDate?.toISOString().slice(0, 10);
  const end = group.endDate?.toISOString().slice(0, 10);
  if ((start && day < start) || (end && day > end)) {
    const window =
      group.startDate && group.endDate
        ? `between ${formatDay(group.startDate)} and ${formatDay(group.endDate)}`
        : group.startDate
          ? `on or after ${formatDay(group.startDate)}`
          : `on or before ${formatDay(group.endDate!)}`;
    throw BadRequestError(`Expenses in "${group.name}" must be dated ${window}`);
  }
}

// Who can be marked as having paid: yourself, or — for an expense in a
// group — anyone in that group. Super admins may pick anyone. `keepPayer`
// is an edit's existing payer, still allowed as long as the expense isn't
// in a group that excludes them (expenses logged before groups had people).
async function assertPayerAllowed(
  payerId: bigint,
  expenseGroupId: bigint | null | undefined,
  admin: RequestingAdmin,
  keepPayer?: bigint,
) {
  if (admin.isSuperAdmin || payerId === admin.id) return;
  const members = expenseGroupId
    ? await prisma.expenseGroupMember.findMany({ where: { expenseGroupId }, select: { adminUserId: true } })
    : [];
  if (members.some((member) => member.adminUserId === payerId)) return;
  if (keepPayer === payerId && members.length === 0) return;
  throw BadRequestError(
    expenseGroupId
      ? "The person who paid must be one of the people in this group"
      : "Only expenses in a group can be marked as paid by someone else",
  );
}

async function assertSavingsGoalOpen(savingsGoalId: bigint | null | undefined) {
  if (!savingsGoalId) return;
  const goal = await prisma.savingsGoal.findUnique({ where: { id: savingsGoalId } });
  if (goal?.closedAt) {
    throw BadRequestError(`Savings goal "${goal.name}" is closed`);
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

export async function createExpense(input: ExpenseInput, admin: RequestingAdmin) {
  await assertGroupOpen(input.expenseGroupId);
  await assertPayerAllowed(input.paidByAdminUserId, input.expenseGroupId, admin);
  await assertSavingsGoalOpen(input.savingsGoalId);
  await assertDateInGroupWindow(input.expenseGroupId, new Date(input.date));

  const created = await prisma.expense.create({
    data: {
      amount: input.amount,
      date: new Date(input.date),
      description: input.description,
      categoryId: input.categoryId,
      paidByAdminUserId: input.paidByAdminUserId,
      createdByAdminUserId: admin.id,
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
  await assertGroupOpen(existing.expenseGroupId);
  if (input.expenseGroupId !== undefined && input.expenseGroupId !== existing.expenseGroupId) {
    await assertGroupOpen(input.expenseGroupId);
  }
  if (input.savingsGoalId !== undefined && input.savingsGoalId !== existing.savingsGoalId) {
    await assertSavingsGoalOpen(input.savingsGoalId);
  }
  const groupId = input.expenseGroupId !== undefined ? input.expenseGroupId : existing.expenseGroupId;
  await assertDateInGroupWindow(groupId, input.date ? new Date(input.date) : existing.date);
  const payerId = input.paidByAdminUserId ?? existing.paidByAdminUserId;
  if (payerId !== existing.paidByAdminUserId || groupId !== existing.expenseGroupId) {
    await assertPayerAllowed(payerId, groupId, admin, existing.paidByAdminUserId);
  }

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
  await assertGroupOpen(existing.expenseGroupId);
  await prisma.expense.delete({ where: { id } });
}
