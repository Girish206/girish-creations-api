import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/httpError";

const includeRelations = {
  contributions: {
    include: { contributedBy: { select: { id: true, email: true, name: true } } },
    orderBy: { date: "desc" as const },
  },
  accountHolder: { select: { id: true, email: true, name: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  members: { include: { adminUser: { select: { id: true, email: true, name: true } } } },
} as const;

export interface RequestingAdmin {
  id: bigint;
  isOwner: boolean;
}

// Private by default (visible only to whoever created it, and whoever
// holds the account) — add people as members to share it with them too,
// same "private unless grouped" rule as Expenses. Legacy rows from before
// createdByAdminUserId existed have no known owner, so they stay visible
// to everyone rather than becoming inaccessible to their actual users.
export async function listSavingsGoals(admin: RequestingAdmin) {
  return prisma.savingsGoal.findMany({
    where: admin.isOwner
      ? undefined
      : {
          OR: [
            { createdByAdminUserId: admin.id },
            { accountHolderAdminUserId: admin.id },
            { members: { some: { adminUserId: admin.id } } },
            { createdByAdminUserId: null },
          ],
        },
    include: includeRelations,
    orderBy: { createdAt: "desc" },
  });
}

// Same visibility rule as the list query, applied to a single goal so
// direct mutations (edit/delete/contribute) respect it too, not just what
// the list happens to show.
async function assertGoalAccess(goalId: bigint, admin: RequestingAdmin) {
  if (admin.isOwner) return;
  const goal = await prisma.savingsGoal.findUnique({
    where: { id: goalId },
    include: { members: true },
  });
  if (!goal) return;
  const allowed =
    goal.createdByAdminUserId === null ||
    goal.createdByAdminUserId === admin.id ||
    goal.accountHolderAdminUserId === admin.id ||
    goal.members.some((m) => m.adminUserId === admin.id);
  if (!allowed) {
    throw ForbiddenError("You don't have access to this savings goal");
  }
}

async function replaceGoalMembers(goalId: bigint, adminUserIds: bigint[]) {
  await prisma.savingsGoalMember.deleteMany({ where: { savingsGoalId: goalId } });
  if (adminUserIds.length > 0) {
    await prisma.savingsGoalMember.createMany({
      data: adminUserIds.map((adminUserId) => ({ savingsGoalId: goalId, adminUserId })),
    });
  }
}

export interface SavingsGoalInput {
  name: string;
  // Omitted/null = open-ended goal (no fixed target, just a running total
  // of contributions — e.g. "saving ₹5000/month" with no end amount).
  targetAmount?: string | null;
  targetDate?: string | null;
  // Where the money physically sits, and who holds that account.
  bankName?: string | null;
  accountHolderAdminUserId?: bigint | null;
  // Who can see/use this goal beyond the creator/account holder — empty/
  // omitted means it's private to just them.
  memberAdminUserIds?: bigint[];
}

export async function createSavingsGoal(input: SavingsGoalInput, createdByAdminUserId: bigint) {
  const created = await prisma.savingsGoal.create({
    data: {
      name: input.name,
      targetAmount: input.targetAmount || null,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      bankName: input.bankName || null,
      accountHolderAdminUserId: input.accountHolderAdminUserId ?? null,
      createdByAdminUserId,
    },
  });

  if (input.memberAdminUserIds && input.memberAdminUserIds.length > 0) {
    await replaceGoalMembers(created.id, input.memberAdminUserIds);
  }

  return prisma.savingsGoal.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations });
}

export async function updateSavingsGoal(id: bigint, input: Partial<SavingsGoalInput>, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);

  await prisma.savingsGoal.update({
    where: { id },
    data: {
      name: input.name,
      targetAmount: input.targetAmount !== undefined ? input.targetAmount || null : undefined,
      targetDate: input.targetDate !== undefined ? (input.targetDate ? new Date(input.targetDate) : null) : undefined,
      bankName: input.bankName !== undefined ? input.bankName || null : undefined,
      accountHolderAdminUserId:
        input.accountHolderAdminUserId !== undefined ? input.accountHolderAdminUserId : undefined,
    },
  });

  if (input.memberAdminUserIds !== undefined) {
    await replaceGoalMembers(id, input.memberAdminUserIds);
  }

  return prisma.savingsGoal.findUniqueOrThrow({ where: { id }, include: includeRelations });
}

export async function deleteSavingsGoal(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  await prisma.savingsGoal.delete({ where: { id } });
}

export interface SavingsContributionInput {
  amount: string;
  date: string;
  contributedByAdminUserId: bigint;
}

export async function addSavingsContribution(
  goalId: bigint,
  input: SavingsContributionInput,
  admin: RequestingAdmin,
) {
  const goal = await prisma.savingsGoal.findUnique({ where: { id: goalId } });
  if (!goal) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(goalId, admin);

  await prisma.savingsContribution.create({
    data: {
      goalId,
      amount: input.amount,
      date: new Date(input.date),
      contributedByAdminUserId: input.contributedByAdminUserId,
    },
  });

  return prisma.savingsGoal.findUniqueOrThrow({ where: { id: goalId }, include: includeRelations });
}

export async function deleteSavingsContribution(goalId: bigint, contributionId: bigint, admin: RequestingAdmin) {
  const existing = await prisma.savingsContribution.findUnique({ where: { id: contributionId } });
  if (!existing || existing.goalId !== goalId) {
    throw NotFoundError("Contribution not found");
  }
  await assertGoalAccess(goalId, admin);
  await prisma.savingsContribution.delete({ where: { id: contributionId } });
}
