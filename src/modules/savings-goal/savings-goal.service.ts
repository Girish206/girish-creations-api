import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { toCents } from "../../utils/money";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";

const includeRelations = {
  contributions: {
    include: { contributedBy: { select: { id: true, email: true, name: true } } },
    orderBy: { date: "desc" as const },
  },
  accountHolder: { select: { id: true, email: true, name: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  members: { include: { adminUser: { select: { id: true, email: true, name: true } } } },
  // Only read to total what's been spent from the goal — individual expenses
  // stay private to the people involved.
  expenses: { select: { amount: true } },
} as const;

type LoadedGoal = Prisma.SavingsGoalGetPayload<{ include: typeof includeRelations }>;

function present({ expenses, ...goal }: LoadedGoal) {
  const spentCents = expenses.reduce((sum, expense) => sum + toCents(expense.amount), 0);
  return { ...goal, spentAmount: (spentCents / 100).toFixed(2) };
}

export interface RequestingAdmin {
  id: bigint;
  isSuperAdmin: boolean;
}

// Private by default (visible only to whoever created it, and whoever
// holds the account) — add people as members to share it with them too,
// same "private unless grouped" rule as Expenses. Anyone who has contributed
// keeps it too, which is how older goals with no known creator stay available
// to those using them.
function visibleTo(admin: RequestingAdmin): Prisma.SavingsGoalWhereInput {
  return {
    OR: [
      { createdByAdminUserId: admin.id },
      { accountHolderAdminUserId: admin.id },
      { members: { some: { adminUserId: admin.id } } },
      { contributions: { some: { contributedByAdminUserId: admin.id } } },
    ],
  };
}

export async function listSavingsGoals(admin: RequestingAdmin) {
  const goals = await prisma.savingsGoal.findMany({
    where: admin.isSuperAdmin ? undefined : visibleTo(admin),
    include: includeRelations,
    // Open goals first (null closedAt sorts first ascending), newest first within each.
    orderBy: [{ closedAt: "asc" }, { createdAt: "desc" }],
  });
  return goals.map(present);
}

// Same visibility rule as the list query, applied to a single goal so
// direct mutations (edit/delete/contribute) respect it too, not just what
// the list happens to show.
export async function assertGoalAccess(goalId: bigint, admin: RequestingAdmin) {
  if (admin.isSuperAdmin) return;
  const visible = await prisma.savingsGoal.count({ where: { id: goalId, ...visibleTo(admin) } });
  if (visible === 0) {
    throw ForbiddenError("You don't have access to this savings goal");
  }
}

type GoalOwners = { createdByAdminUserId: bigint | null; accountHolderAdminUserId: bigint | null };

// A goal's settings and people are for whoever created it or holds the account.
// An older goal with neither stays open to those who can see it, or nobody
// could manage it but a super admin.
export function mayManageGoal(goal: GoalOwners, admin: RequestingAdmin) {
  if (admin.isSuperAdmin) return true;
  if (goal.createdByAdminUserId === null && goal.accountHolderAdminUserId === null) return true;
  return goal.createdByAdminUserId === admin.id || goal.accountHolderAdminUserId === admin.id;
}

// Everyone looks after their own contributions. Whoever manages the goal can
// also log one for someone else, like cash handed over or a guest with no login.
export function mayChangeContribution(goal: GoalOwners, contributedById: bigint, admin: RequestingAdmin) {
  return contributedById === admin.id || mayManageGoal(goal, admin);
}

function assertMayManageGoal(goal: GoalOwners, admin: RequestingAdmin) {
  if (!mayManageGoal(goal, admin)) {
    throw ForbiddenError("Only the person who created this goal or holds its account can do this");
  }
}

// Everyone on a goal already, who can stay on it when it's edited.
async function peopleOnGoal(goalId: bigint) {
  const goal = await prisma.savingsGoal.findUnique({
    where: { id: goalId },
    select: {
      createdByAdminUserId: true,
      accountHolderAdminUserId: true,
      members: { select: { adminUserId: true } },
      contributions: { select: { contributedByAdminUserId: true } },
    },
  });
  if (!goal) return [];
  return [
    goal.createdByAdminUserId,
    goal.accountHolderAdminUserId,
    ...goal.members.map((member) => member.adminUserId),
    ...goal.contributions.map((contribution) => contribution.contributedByAdminUserId),
  ];
}

async function replaceGoalMembers(goalId: bigint, adminUserIds: bigint[]) {
  await prisma.savingsGoalMember.deleteMany({ where: { savingsGoalId: goalId } });
  if (adminUserIds.length > 0) {
    await prisma.savingsGoalMember.createMany({
      data: [...new Set(adminUserIds)].map((adminUserId) => ({ savingsGoalId: goalId, adminUserId })),
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

async function assertGoalPeopleAllowed(
  input: Partial<SavingsGoalInput>,
  admin: RequestingAdmin,
  alreadyOn: (bigint | null)[] = [],
) {
  const ids = [
    ...(input.accountHolderAdminUserId ? [input.accountHolderAdminUserId] : []),
    ...(input.memberAdminUserIds ?? []),
  ];
  await assertAdminUsersExist(ids);
  await assertCanPick(ids, admin, alreadyOn);
}

export async function createSavingsGoal(input: SavingsGoalInput, admin: RequestingAdmin) {
  await assertGoalPeopleAllowed(input, admin);
  const createdByAdminUserId = admin.id;
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

  return present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations }));
}

export async function updateSavingsGoal(id: bigint, input: Partial<SavingsGoalInput>, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  assertMayManageGoal(existing, admin);
  await assertGoalPeopleAllowed(input, admin, await peopleOnGoal(id));

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

  return present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id }, include: includeRelations }));
}

export async function setSavingsGoalClosed(id: bigint, closed: boolean, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  assertMayManageGoal(existing, admin);
  await prisma.savingsGoal.update({ where: { id }, data: { closedAt: closed ? new Date() : null } });
  return present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id }, include: includeRelations }));
}

export async function deleteSavingsGoal(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  assertMayManageGoal(existing, admin);
  // A goal's money history isn't thrown away with it: deleting would either
  // fail on its contributions or silently unlink the expenses spent from it.
  const [contributions, expenses] = await Promise.all([
    prisma.savingsContribution.count({ where: { goalId: id } }),
    prisma.expense.count({ where: { savingsGoalId: id } }),
  ]);
  if (contributions > 0 || expenses > 0) {
    const parts = [
      contributions > 0 && `${contributions} contribution${contributions === 1 ? "" : "s"}`,
      expenses > 0 && `${expenses} expense${expenses === 1 ? "" : "s"}`,
    ].filter(Boolean);
    throw ConflictError(`This goal still has ${parts.join(" and ")} — close it instead, or remove them first`);
  }
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
  if (goal.closedAt) {
    throw BadRequestError("This savings goal is closed — reopen it to add contributions");
  }
  if (!mayChangeContribution(goal, input.contributedByAdminUserId, admin)) {
    throw ForbiddenError("You can only add your own contributions to this goal");
  }
  await assertAdminUsersExist([input.contributedByAdminUserId]);
  await assertCanPick([input.contributedByAdminUserId], admin, await peopleOnGoal(goalId));

  await prisma.savingsContribution.create({
    data: {
      goalId,
      amount: input.amount,
      date: new Date(input.date),
      contributedByAdminUserId: input.contributedByAdminUserId,
    },
  });

  return present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id: goalId }, include: includeRelations }));
}

export async function deleteSavingsContribution(goalId: bigint, contributionId: bigint, admin: RequestingAdmin) {
  const existing = await prisma.savingsContribution.findUnique({ where: { id: contributionId } });
  if (!existing || existing.goalId !== goalId) {
    throw NotFoundError("Contribution not found");
  }
  await assertGoalAccess(goalId, admin);
  const goal = await prisma.savingsGoal.findUniqueOrThrow({
    where: { id: goalId },
    select: { closedAt: true, createdByAdminUserId: true, accountHolderAdminUserId: true },
  });
  if (!mayChangeContribution(goal, existing.contributedByAdminUserId, admin)) {
    throw ForbiddenError("You can only remove your own contributions from this goal");
  }
  if (goal.closedAt) {
    throw BadRequestError("This savings goal is closed — reopen it to change its contributions");
  }
  await prisma.savingsContribution.delete({ where: { id: contributionId } });
}
