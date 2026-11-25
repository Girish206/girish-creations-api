import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { toCents } from "../../utils/money";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { formatAmount, logActivity, namesOf } from "../activity/activity.service";
import { sendNotices } from "../activity/money-email";
import { computeFundSplit, FUND_KIND, fundPeople, isSharedFund } from "./fund-split";

const personSelect = { select: { id: true, email: true, name: true } } as const;

const includeRelations = {
  contributions: {
    include: { contributedBy: { select: { id: true, email: true, name: true } } },
    orderBy: { date: "desc" as const },
  },
  accountHolder: { select: { id: true, email: true, name: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  members: { include: { adminUser: { select: { id: true, email: true, name: true } } } },
  // Only read to total what's been spent from the goal, and for a shared fund
  // who shares it — individual expenses stay private to the people involved.
  expenses: {
    select: {
      amount: true,
      splitParticipants: { select: { shareAmount: true, adminUser: personSelect } },
    },
  },
  // A shared fund's trip group, where its spending and settle-up live.
  fundGroups: { select: { id: true }, take: 1 },
} as const;

type LoadedGoal = Prisma.SavingsGoalGetPayload<{ include: typeof includeRelations }>;

function present({ expenses, fundGroups, ...goal }: LoadedGoal) {
  const spentCents = expenses.reduce((sum, expense) => sum + toCents(expense.amount), 0);
  return {
    ...goal,
    expenseGroupId: fundGroups[0]?.id ?? null,
    spentAmount: (spentCents / 100).toFixed(2),
    // Shared funds only: each person's put in, share and what's left to settle.
    fundSplit: isSharedFund(goal)
      ? computeFundSplit(fundPeople(goal), goal.contributions, expenses)
      : null,
  };
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

// Someone with contributions in a goal keeps seeing it, so they can't be taken
// off it: taking someone off a goal always takes it away from them.
async function assertNotRemovingContributors(
  goalId: bigint,
  existing: { createdByAdminUserId: bigint | null; accountHolderAdminUserId: bigint | null },
  input: Partial<SavingsGoalInput>,
) {
  if (input.memberAdminUserIds === undefined && input.accountHolderAdminUserId === undefined) return;
  const members = await prisma.savingsGoalMember.findMany({
    where: { savingsGoalId: goalId },
    select: { adminUserId: true },
  });
  const onNow = [existing.accountHolderAdminUserId, ...members.map((member) => member.adminUserId)];
  const nextHolder =
    input.accountHolderAdminUserId !== undefined ? input.accountHolderAdminUserId : existing.accountHolderAdminUserId;
  const nextMembers = input.memberAdminUserIds ?? members.map((member) => member.adminUserId);
  const onNext = new Set([existing.createdByAdminUserId, nextHolder, ...nextMembers]);
  const removed = onNow.filter((id): id is bigint => id !== null && !onNext.has(id));
  if (removed.length === 0) return;
  const contribution = await prisma.savingsContribution.findFirst({
    where: { goalId, contributedByAdminUserId: { in: removed } },
    select: { contributedBy: { select: { name: true, email: true } } },
  });
  if (contribution) {
    const who = contribution.contributedBy.name || contribution.contributedBy.email || "Someone";
    throw BadRequestError(`${who} has contributions in this goal, so they can't be taken off it`);
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
  // "savings" or "fund" (a shared fund, split at the end).
  kind?: "savings" | "fund";
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

// A shared fund pays for a trip, so it gets that trip's expense group: same
// name, same people. Expenses logged there choose between the fund and the
// payer's own money, and one settle-up covers both. Made (or brought up to
// date) whenever a fund is created or changed; never removes anyone, since
// people with money in a group can't be taken out of it.
export async function syncFundGroup(goalId: bigint, actorId: bigint) {
  const goal = await prisma.savingsGoal.findUnique({
    where: { id: goalId },
    select: {
      name: true,
      kind: true,
      createdByAdminUserId: true,
      accountHolderAdminUserId: true,
      members: { select: { adminUserId: true } },
      contributions: { select: { contributedByAdminUserId: true } },
      fundGroups: { select: { id: true, name: true, members: { select: { adminUserId: true } } }, take: 1 },
    },
  });
  if (!goal || !isSharedFund(goal)) return null;
  const peopleIds = [
    ...new Set(
      [
        goal.createdByAdminUserId ?? actorId,
        goal.accountHolderAdminUserId,
        ...goal.members.map((member) => member.adminUserId),
        ...goal.contributions.map((contribution) => contribution.contributedByAdminUserId),
      ].filter((id): id is bigint => id !== null),
    ),
  ];

  const linked = goal.fundGroups[0];
  if (!linked) {
    const group = await prisma.expenseGroup.create({
      data: { name: goal.name, fundGoalId: goalId, createdByAdminUserId: goal.createdByAdminUserId ?? actorId },
    });
    await prisma.expenseGroupMember.createMany({
      data: peopleIds.map((adminUserId) => ({ expenseGroupId: group.id, adminUserId })),
    });
    await logActivity({
      actorId,
      action: "group.created",
      summary: `Created ${goal.name} for the shared fund`,
      involved: peopleIds,
      expenseGroupId: group.id,
      savingsGoalId: goalId,
    });
    return group.id;
  }

  if (linked.name !== goal.name) {
    await prisma.expenseGroup.update({ where: { id: linked.id }, data: { name: goal.name } });
  }
  const have = new Set(linked.members.map((member) => member.adminUserId));
  const missing = peopleIds.filter((id) => !have.has(id));
  if (missing.length > 0) {
    await prisma.expenseGroupMember.createMany({
      data: missing.map((adminUserId) => ({ expenseGroupId: linked.id, adminUserId })),
    });
  }
  return linked.id;
}

// A shared fund can go back to plain savings only while nothing has used it as
// a fund: no money spent from it, and nothing on its trip group. Otherwise
// those expenses would quietly turn into "everyone owes the payer". Returns
// the empty trip groups to delete once the goal is saved.
async function assertMayStopBeingFund(goalId: bigint) {
  const spent = await prisma.expense.count({ where: { savingsGoalId: goalId } });
  if (spent > 0) {
    throw ConflictError(
      `${spent} expense${spent === 1 ? " was" : "s were"} paid from this fund, so it has to stay a shared fund. Close it instead.`,
    );
  }
  const groups = await prisma.expenseGroup.findMany({
    where: { fundGoalId: goalId },
    select: { id: true, name: true, members: { select: { adminUserId: true } } },
  });
  for (const group of groups) {
    const [expenses, settlements] = await Promise.all([
      prisma.expense.count({ where: { expenseGroupId: group.id } }),
      prisma.expenseGroupSettlement.count({ where: { expenseGroupId: group.id } }),
    ]);
    if (expenses > 0 || settlements > 0) {
      throw ConflictError(`${group.name} already has expenses or repayments, so this has to stay a shared fund. Close it instead.`);
    }
  }
  return groups;
}

// The fund's trip group was made automatically and is still empty: it goes
// with the fund.
async function deleteEmptyFundGroups(
  groups: { id: bigint; name: string; members: { adminUserId: bigint }[] }[],
  goalId: bigint,
  actorId: bigint,
) {
  for (const group of groups) {
    await prisma.expenseGroupMember.deleteMany({ where: { expenseGroupId: group.id } });
    await prisma.expenseGroup.delete({ where: { id: group.id } });
    await logActivity({
      actorId,
      action: "group.deleted",
      summary: `Deleted ${group.name}, as it's no longer a shared fund`,
      involved: group.members.map((member) => member.adminUserId),
      expenseGroupId: group.id,
      savingsGoalId: goalId,
    });
  }
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
      kind: input.kind === FUND_KIND ? FUND_KIND : null,
      createdByAdminUserId,
    },
  });

  if (input.memberAdminUserIds && input.memberAdminUserIds.length > 0) {
    await replaceGoalMembers(created.id, input.memberAdminUserIds);
  }

  await logActivity({
    actorId: admin.id,
    action: "goal.created",
    summary: `Created the savings goal ${input.name}`,
    involved: await peopleOnGoal(created.id),
    savingsGoalId: created.id,
  });
  await syncFundGroup(created.id, admin.id);
  return present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations }));
}

export async function updateSavingsGoal(id: bigint, input: Partial<SavingsGoalInput>, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  assertMayManageGoal(existing, admin);
  const peopleBefore = await peopleOnGoal(id);
  await assertGoalPeopleAllowed(input, admin, peopleBefore);
  await assertNotRemovingContributors(id, existing, input);
  const stoppingFund = isSharedFund(existing) && input.kind !== undefined && input.kind !== FUND_KIND;
  const emptyFundGroups = stoppingFund ? await assertMayStopBeingFund(id) : [];

  await prisma.savingsGoal.update({
    where: { id },
    data: {
      name: input.name,
      targetAmount: input.targetAmount !== undefined ? input.targetAmount || null : undefined,
      targetDate: input.targetDate !== undefined ? (input.targetDate ? new Date(input.targetDate) : null) : undefined,
      bankName: input.bankName !== undefined ? input.bankName || null : undefined,
      accountHolderAdminUserId:
        input.accountHolderAdminUserId !== undefined ? input.accountHolderAdminUserId : undefined,
      kind: input.kind !== undefined ? (input.kind === FUND_KIND ? FUND_KIND : null) : undefined,
    },
  });

  if (input.memberAdminUserIds !== undefined) {
    await replaceGoalMembers(id, input.memberAdminUserIds);
  }
  await deleteEmptyFundGroups(emptyFundGroups, id, admin.id);
  await syncFundGroup(id, admin.id);

  const updated = present(await prisma.savingsGoal.findUniqueOrThrow({ where: { id }, include: includeRelations }));
  await logActivity({
    actorId: admin.id,
    action: "goal.updated",
    summary: `Changed the savings goal ${updated.name}`,
    involved: [...peopleBefore, ...(await peopleOnGoal(id))],
    savingsGoalId: id,
  });
  return updated;
}

export async function setSavingsGoalClosed(id: bigint, closed: boolean, admin: RequestingAdmin) {
  const existing = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Savings goal not found");
  }
  await assertGoalAccess(id, admin);
  assertMayManageGoal(existing, admin);
  await prisma.savingsGoal.update({ where: { id }, data: { closedAt: closed ? new Date() : null } });
  if (Boolean(existing.closedAt) !== closed) {
    await logActivity({
      actorId: admin.id,
      action: closed ? "goal.closed" : "goal.reopened",
      summary: `${closed ? "Closed" : "Reopened"} the savings goal ${existing.name}`,
      involved: await peopleOnGoal(id),
      savingsGoalId: id,
    });
  }
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
  const involved = await peopleOnGoal(id);
  // Its trip group stays (with its own expenses), just no longer linked.
  await prisma.expenseGroup.updateMany({ where: { fundGoalId: id }, data: { fundGoalId: null } });
  await prisma.savingsGoalMember.deleteMany({ where: { savingsGoalId: id } });
  await prisma.savingsGoal.delete({ where: { id } });
  await logActivity({
    actorId: admin.id,
    action: "goal.deleted",
    summary: `Deleted the savings goal ${existing.name}`,
    involved,
    savingsGoalId: id,
  });
}

// Logs a contribution change, and tells the contributor when someone else
// made it for them.
async function recordContribution(
  change: "added" | "removed",
  goal: { id: bigint; name: string },
  contribution: { amount: string; contributedByAdminUserId: bigint },
  admin: RequestingAdmin,
) {
  const name = await namesOf([admin.id, contribution.contributedByAdminUserId]);
  const amount = formatAmount(contribution.amount);
  const forSomeoneElse = contribution.contributedByAdminUserId !== admin.id;
  const whose = forSomeoneElse ? ` for ${name(contribution.contributedByAdminUserId)}` : "";
  await logActivity({
    actorId: admin.id,
    action: change === "added" ? "contribution.added" : "contribution.removed",
    summary:
      change === "added"
        ? `Added ${amount}${whose} to ${goal.name}`
        : `Removed a contribution of ${amount}${whose} from ${goal.name}`,
    involved: await peopleOnGoal(goal.id),
    savingsGoalId: goal.id,
  });
  if (!forSomeoneElse) return;
  await sendNotices([contribution.contributedByAdminUserId], admin.id, () => ({
    subject: change === "added" ? `${amount} added to ${goal.name} for you` : `A contribution of yours was removed`,
    lines: [
      change === "added"
        ? `${name(admin.id)} recorded ${amount} from you in the savings goal ${goal.name}.`
        : `${name(admin.id)} removed your contribution of ${amount} from the savings goal ${goal.name}.`,
      "If that's not right, open Pocket to check.",
    ],
    footer: "You're receiving this because the contribution is yours.",
    reference: `contribution-${change}-${goal.id}`,
  }));
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
  // Someone with money in a goal is one of its people, like in a group.
  const contributor = input.contributedByAdminUserId;
  if (contributor !== goal.createdByAdminUserId && contributor !== goal.accountHolderAdminUserId) {
    const isMember = await prisma.savingsGoalMember.count({
      where: { savingsGoalId: goalId, adminUserId: contributor },
    });
    if (isMember === 0) {
      await prisma.savingsGoalMember.create({ data: { savingsGoalId: goalId, adminUserId: contributor } });
    }
  }
  await syncFundGroup(goalId, admin.id);
  await recordContribution("added", goal, input, admin);

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
    select: { id: true, name: true, closedAt: true, createdByAdminUserId: true, accountHolderAdminUserId: true },
  });
  if (!mayChangeContribution(goal, existing.contributedByAdminUserId, admin)) {
    throw ForbiddenError("You can only remove your own contributions from this goal");
  }
  if (goal.closedAt) {
    throw BadRequestError("This savings goal is closed — reopen it to change its contributions");
  }
  await prisma.savingsContribution.delete({ where: { id: contributionId } });
  await recordContribution("removed", goal, existing, admin);
}
