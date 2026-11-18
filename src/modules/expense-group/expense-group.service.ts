import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { EmailError, isEmailEnabled, sendEmail } from "../../lib/email";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError } from "../../utils/httpError";
import { maskEmail } from "../auth/auth-code";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { maxRepaymentCents, suggestTransfers, summarizeGroup, type GroupFund } from "./group-balances";
import { computeFundSplit, fundPeople } from "../savings-goal/fund-split";
import { buildSplitEmail, splitEmailAudience } from "./group-split-email";
import { logActivity, namesOf } from "../activity/activity.service";
import { recordRepayment } from "../activity/repayments";

const userSelect = { select: { id: true, email: true, name: true } } as const;

const includeRelations = {
  settlements: {
    include: { fromAdminUser: userSelect, toAdminUser: userSelect },
    orderBy: { date: "desc" as const },
  },
  members: { include: { adminUser: userSelect } },
  // Only read to work out the group's totals — never sent to the client,
  // since individual expenses stay private to the people involved.
  expenses: {
    select: {
      amount: true,
      paidBy: userSelect,
      savingsGoal: { select: { kind: true } },
      splitParticipants: { select: { shareAmount: true, adminUser: userSelect } },
    },
  },
  // The shared fund this trip is paid from, if any: read whole so its money
  // settles together with the trip's own expenses.
  fundGoal: {
    select: {
      id: true,
      name: true,
      closedAt: true,
      accountHolderAdminUserId: true,
      accountHolder: userSelect,
      createdBy: userSelect,
      members: { select: { adminUser: userSelect } },
      contributions: { select: { amount: true, contributedBy: userSelect } },
      expenses: {
        select: { amount: true, splitParticipants: { select: { shareAmount: true, adminUser: userSelect } } },
      },
    },
  },
} as const;

type LoadedGroup = Prisma.ExpenseGroupGetPayload<{ include: typeof includeRelations }>;

// The linked fund's split, and who keeps its money (the account holder, else
// whoever made it).
function fundOf(group: LoadedGroup): GroupFund | null {
  const fund = group.fundGoal;
  const holder = fund?.accountHolder ?? fund?.createdBy;
  if (!fund || !holder) return null;
  return { holder, split: computeFundSplit(fundPeople(fund), fund.contributions, fund.expenses) };
}

function summaryOf(group: LoadedGroup) {
  return summarizeGroup(group.expenses, group.settlements, fundOf(group));
}

function present(loaded: LoadedGroup) {
  const summary = summaryOf(loaded);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expenses, fundGoal, ...group } = loaded;
  const fund = fundGoal
    ? {
        id: fundGoal.id,
        name: fundGoal.name,
        closedAt: fundGoal.closedAt,
        holderAdminUserId: (fundGoal.accountHolder ?? fundGoal.createdBy)?.id ?? null,
        putInCents: summary.balances.reduce((sum, b) => sum + b.fundPutInCents, 0),
        spentCents: summary.balances.reduce((sum, b) => sum + b.fundShareCents, 0),
      }
    : null;
  return { ...group, fund, ...summary };
}

export interface RequestingAdmin {
  id: bigint;
  isSuperAdmin: boolean;
}

// A group belongs to the people in it. Anyone with an expense or repayment in
// it can see it too, which is how older groups with no people recorded stay
// available to those using them.
function visibleTo(admin: RequestingAdmin): Prisma.ExpenseGroupWhereInput {
  if (admin.isSuperAdmin) return {};
  return {
    OR: [
      { members: { some: { adminUserId: admin.id } } },
      {
        expenses: {
          some: {
            OR: [
              { paidByAdminUserId: admin.id },
              { createdByAdminUserId: admin.id },
              { splitParticipants: { some: { adminUserId: admin.id } } },
            ],
          },
        },
      },
      { settlements: { some: { OR: [{ fromAdminUserId: admin.id }, { toAdminUserId: admin.id }] } } },
    ],
  };
}

export async function assertGroupAccess(id: bigint, admin: RequestingAdmin) {
  if (admin.isSuperAdmin) return;
  const visible = await prisma.expenseGroup.count({ where: { id, ...visibleTo(admin) } });
  if (visible === 0) {
    throw ForbiddenError("You don't have access to this expense group");
  }
}

export async function listExpenseGroups(admin: RequestingAdmin) {
  const groups = await prisma.expenseGroup.findMany({
    where: visibleTo(admin),
    include: includeRelations,
    orderBy: { createdAt: "desc" },
  });
  return groups.map(present);
}

export interface ExpenseGroupInput {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  // The people in the group. Undefined leaves them as they are on update.
  memberAdminUserIds?: bigint[];
}

async function replaceMembers(expenseGroupId: bigint, adminUserIds: bigint[]) {
  await prisma.expenseGroupMember.deleteMany({ where: { expenseGroupId } });
  if (adminUserIds.length > 0) {
    await prisma.expenseGroupMember.createMany({
      data: adminUserIds.map((adminUserId) => ({ expenseGroupId, adminUserId })),
    });
  }
}

const unique = (ids: bigint[]) => [...new Set(ids)];

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

function assertValidRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (startDate && endDate && startDate.slice(0, 10) > endDate.slice(0, 10)) {
    throw BadRequestError("End date can't be before the start date");
  }
}

// Anyone paying for or sharing an expense in a group is one of its people.
// Older groups with no people recorded are left as they are.
export async function addMissingMembers(expenseGroupId: bigint, adminUserIds: bigint[]) {
  const existing = await prisma.expenseGroupMember.findMany({
    where: { expenseGroupId },
    select: { adminUserId: true },
  });
  if (existing.length === 0) return;
  const have = new Set(existing.map((member) => member.adminUserId));
  const missing = unique(adminUserIds).filter((id) => !have.has(id));
  if (missing.length > 0) {
    await prisma.expenseGroupMember.createMany({
      data: missing.map((adminUserId) => ({ expenseGroupId, adminUserId })),
    });
  }
}

// `creator` joins the group when no members are given (e.g. a group typed
// straight into a picker). Only a super admin can make a group they aren't
// in — anyone else would lose sight of it straight away.
export async function createExpenseGroup(input: ExpenseGroupInput, creator: RequestingAdmin) {
  assertValidRange(input.startDate, input.endDate);
  const memberIds = unique([
    ...(input.memberAdminUserIds ?? [creator.id]),
    ...(creator.isSuperAdmin ? [] : [creator.id]),
  ]);
  if (memberIds.length === 0) {
    throw BadRequestError("Add at least one person to the group");
  }
  await assertAdminUsersExist(memberIds);
  await assertCanPick(memberIds, creator);
  const created = await prisma.expenseGroup.create({
    data: {
      name: input.name,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      createdByAdminUserId: creator.id,
    },
  });
  await replaceMembers(created.id, memberIds);
  await logActivity({
    actorId: creator.id,
    action: "group.created",
    summary: `Created ${input.name}`,
    involved: memberIds,
    expenseGroupId: created.id,
  });
  return present(await prisma.expenseGroup.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations }));
}

async function findGroupOrThrow(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.expenseGroup.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Trip/event not found");
  }
  await assertGroupAccess(id, admin);
  return existing;
}

// Adding people to a group and emailing its split-up is for the people in it.
// Someone who only logged an expense in it can see it, not change it. An older
// group with no people recorded stays open to those who can see it.
export function mayManageGroup(memberIds: bigint[], admin: RequestingAdmin) {
  return admin.isSuperAdmin || memberIds.length === 0 || memberIds.includes(admin.id);
}

// Renaming it, changing its dates, taking people out, closing, reopening and
// deleting it is for whoever created it, so one person can't undo a settled
// trip for everyone. A group with no known creator in it (an older one, or
// one a super admin made for others) leaves that to its people.
export function mayRunGroup(
  group: { createdByAdminUserId: bigint | null },
  memberIds: bigint[],
  admin: RequestingAdmin,
) {
  if (admin.isSuperAdmin) return true;
  const creator = group.createdByAdminUserId;
  if (creator !== null && memberIds.includes(creator)) return creator === admin.id;
  return mayManageGroup(memberIds, admin);
}

async function memberIdsOf(id: bigint) {
  const members = await prisma.expenseGroupMember.findMany({
    where: { expenseGroupId: id },
    select: { adminUserId: true },
  });
  return members.map((member) => member.adminUserId);
}

async function findManageableGroupOrThrow(id: bigint, admin: RequestingAdmin) {
  const existing = await findGroupOrThrow(id, admin);
  const memberIds = await memberIdsOf(id);
  if (!mayManageGroup(memberIds, admin)) {
    throw ForbiddenError("Only the people in this group can change it");
  }
  return { existing, memberIds };
}

async function findRunnableGroupOrThrow(id: bigint, admin: RequestingAdmin) {
  const found = await findManageableGroupOrThrow(id, admin);
  if (!mayRunGroup(found.existing, found.memberIds, admin)) {
    throw ForbiddenError("Only the person who created this group can do this");
  }
  return found;
}

// People with money recorded against a group can't be taken out of it —
// their paid amounts, shares or repayments would still count in its balances.
async function assertNotRemovingInvolvedPeople(id: bigint, memberIds: bigint[]) {
  const [payer, sharer, settlement, logger] = await Promise.all([
    prisma.expense.findFirst({
      where: { expenseGroupId: id, paidByAdminUserId: { notIn: memberIds } },
      select: { paidBy: { select: { name: true, email: true } } },
    }),
    prisma.expenseSplitParticipant.findFirst({
      where: { expense: { expenseGroupId: id }, adminUserId: { notIn: memberIds } },
      select: { adminUser: { select: { name: true, email: true } } },
    }),
    prisma.expenseGroupSettlement.findFirst({
      where: {
        expenseGroupId: id,
        OR: [{ fromAdminUserId: { notIn: memberIds } }, { toAdminUserId: { notIn: memberIds } }],
      },
      select: { id: true },
    }),
    // Whoever logged an expense keeps seeing it, so they stay in the group too:
    // taking someone out of a group always takes it away from them.
    prisma.expense.findFirst({
      where: { expenseGroupId: id, createdByAdminUserId: { notIn: memberIds, not: null } },
      select: { createdBy: { select: { name: true, email: true } } },
    }),
  ]);
  if (payer) {
    const who = payer.paidBy.name || payer.paidBy.email || "Someone";
    throw BadRequestError(`${who} paid for an expense in this group, so they can't be removed from it`);
  }
  if (sharer) {
    const who = sharer.adminUser.name || sharer.adminUser.email || "Someone";
    throw BadRequestError(`${who} shares an expense in this group, so they can't be removed from it`);
  }
  if (settlement) {
    throw BadRequestError("Someone being removed has a recorded repayment in this group — remove it first");
  }
  if (logger?.createdBy) {
    const who = logger.createdBy.name || logger.createdBy.email || "Someone";
    throw BadRequestError(`${who} logged an expense in this group, so they can't be removed from it`);
  }
}

// Everyone on a group already: its members, plus anyone with money in it (an
// older group has no members recorded, only those).
async function peopleInGroup(id: bigint) {
  const group = await prisma.expenseGroup.findUniqueOrThrow({ where: { id }, include: includeRelations });
  return [
    ...group.members.map((member) => member.adminUserId),
    ...summaryOf(group).balances.map((balance) => balance.adminUserId),
  ];
}

export async function updateExpenseGroup(id: bigint, input: Partial<ExpenseGroupInput>, admin: RequestingAdmin) {
  const { existing, memberIds: currentIds } = await findManageableGroupOrThrow(id, admin);
  const startDate = input.startDate !== undefined ? input.startDate : existing.startDate && dayOf(existing.startDate);
  const endDate = input.endDate !== undefined ? input.endDate : existing.endDate && dayOf(existing.endDate);
  assertValidRange(startDate, endDate);

  const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
  const renamed = input.name !== undefined && input.name !== existing.name;
  const datesChanged =
    day(startDate) !== day(existing.startDate && dayOf(existing.startDate)) ||
    day(endDate) !== day(existing.endDate && dayOf(existing.endDate));
  const nextIds = input.memberAdminUserIds !== undefined ? unique(input.memberAdminUserIds) : currentIds;
  const removedIds = currentIds.filter((memberId) => !nextIds.includes(memberId));
  const addedIds = nextIds.filter((memberId) => !currentIds.includes(memberId));
  if ((renamed || datesChanged || removedIds.length > 0) && !mayRunGroup(existing, currentIds, admin)) {
    throw ForbiddenError("Only the person who created this group can rename it, change its dates or take people out");
  }
  const creator = existing.createdByAdminUserId;
  if (creator !== null && removedIds.includes(creator)) {
    throw BadRequestError("Whoever created the group stays in it");
  }

  // Narrowing the window mustn't strand expenses already logged outside it.
  if (startDate || endDate) {
    const outside = await prisma.expense.count({
      where: {
        expenseGroupId: id,
        OR: [
          ...(startDate ? [{ date: { lt: new Date(startDate) } }] : []),
          ...(endDate ? [{ date: { gt: new Date(endDate) } }] : []),
        ],
      },
    });
    if (outside > 0) {
      throw BadRequestError(
        `${outside} expense${outside === 1 ? " is" : "s are"} dated outside these dates — change ${outside === 1 ? "its" : "their"} date first`,
      );
    }
  }

  if (input.memberAdminUserIds !== undefined) {
    const memberIds = unique(input.memberAdminUserIds);
    if (memberIds.length === 0) {
      throw BadRequestError("Add at least one person to the group");
    }
    await assertAdminUsersExist(memberIds);
    await assertCanPick(memberIds, admin, await peopleInGroup(id));
    await assertNotRemovingInvolvedPeople(id, memberIds);
    await replaceMembers(id, memberIds);
  }

  const updated = await prisma.expenseGroup.update({
    where: { id },
    data: {
      name: input.name,
      startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
    },
    include: includeRelations,
  });

  const name = await namesOf([...addedIds, ...removedIds]);
  const changes = [
    ...(renamed ? [`renamed it from ${existing.name}`] : []),
    ...(datesChanged ? ["changed its dates"] : []),
    ...(addedIds.length ? [`added ${addedIds.map(name).join(", ")}`] : []),
    ...(removedIds.length ? [`took out ${removedIds.map(name).join(", ")}`] : []),
  ];
  if (changes.length > 0) {
    await logActivity({
      actorId: admin.id,
      action: "group.updated",
      summary: `${updated.name}: ${changes.join(", ")}`,
      involved: [...currentIds, ...nextIds],
      expenseGroupId: id,
    });
  }
  return present(updated);
}

export async function setExpenseGroupClosed(id: bigint, closed: boolean, admin: RequestingAdmin) {
  const { existing } = await findRunnableGroupOrThrow(id, admin);
  const updated = await prisma.expenseGroup.update({
    where: { id },
    data: { closedAt: closed ? new Date() : null },
    include: includeRelations,
  });
  if (Boolean(existing.closedAt) !== closed) {
    await logActivity({
      actorId: admin.id,
      action: closed ? "group.closed" : "group.reopened",
      summary: `${closed ? "Closed" : "Reopened"} ${updated.name}`,
      involved: await peopleInGroup(id),
      expenseGroupId: id,
    });
  }
  return present(updated);
}

export async function deleteExpenseGroup(id: bigint, admin: RequestingAdmin) {
  const { existing, memberIds } = await findRunnableGroupOrThrow(id, admin);
  // Only an empty group can be deleted — counted across everyone's
  // expenses, not just the requester's visible ones, so a group can't be
  // removed out from under someone else's private expenses.
  const expenseCount = await prisma.expense.count({ where: { expenseGroupId: id } });
  if (expenseCount > 0) {
    throw ConflictError(
      `This group still has ${expenseCount} expense${expenseCount === 1 ? "" : "s"} — move or delete them first`,
    );
  }
  await prisma.expenseGroupSettlement.deleteMany({ where: { expenseGroupId: id } });
  await prisma.expenseGroupMember.deleteMany({ where: { expenseGroupId: id } });
  await prisma.expenseGroup.delete({ where: { id } });
  await logActivity({
    actorId: admin.id,
    action: "group.deleted",
    summary: `Deleted ${existing.name}`,
    involved: memberIds,
    expenseGroupId: id,
  });
}

// Stops a double click, or someone repeatedly mailing the whole group.
const SPLIT_EMAIL_COOLDOWN_SECONDS = 60;

export function splitEmailBlocker(
  group: { expenseCount: number; splitEmailSentAt: Date | null },
  now = Date.now(),
) {
  if (group.expenseCount === 0) return "This group has no expenses yet, so there's no split-up to send.";
  const waitSeconds = group.splitEmailSentAt
    ? Math.ceil(SPLIT_EMAIL_COOLDOWN_SECONDS - (now - group.splitEmailSentAt.getTime()) / 1000)
    : 0;
  if (waitSeconds > 0) return `The split-up was just sent. You can send another in ${waitSeconds} seconds.`;
  return null;
}

// Emails everyone in the group the split-up, when someone settling up chooses
// to. Each email is separate, so no one sees anyone else's address.
export async function sendSplitEmail(id: bigint, admin: RequestingAdmin) {
  await findManageableGroupOrThrow(id, admin);
  const group = await prisma.expenseGroup.findUniqueOrThrow({ where: { id }, include: includeRelations });
  const summary = summaryOf(group);
  const blocker = splitEmailBlocker({ expenseCount: summary.expenseCount, splitEmailSentAt: group.splitEmailSentAt });
  if (blocker) throw BadRequestError(blocker);
  if (!isEmailEnabled()) {
    throw new HttpError(503, "Email isn't set up on the server yet, so this can't be sent.", "EMAIL_OFF");
  }

  // Everyone on the group: an older one has no members recorded, only balances.
  const peopleIds = unique([
    ...group.members.map((member) => member.adminUserId),
    ...summary.balances.map((balance) => balance.adminUserId),
  ]);
  const [people, sender] = await Promise.all([
    prisma.adminUser.findMany({
      where: { id: { in: peopleIds } },
      select: { id: true, email: true, name: true, isActive: true, passwordHash: true, hasExpensesAccess: true },
    }),
    prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id }, select: { email: true, name: true } }),
  ]);
  const { recipients, noEmail } = splitEmailAudience(people);
  if (recipients.length === 0) {
    throw BadRequestError("No one in this group has an email address.");
  }

  const sentBy = sender.name?.trim() || (sender.email ? maskEmail(sender.email) : "Someone");
  const emailGroup = { id, name: group.name, ...summary, transfers: suggestTransfers(summary.balances, summary.fundHolderId) };
  const results = await Promise.allSettled(
    recipients.map((recipient) => sendEmail(buildSplitEmail(emailGroup, recipient, sentBy, env.adminSignInUrl))),
  );
  const failed = results.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
  for (const error of failed) {
    const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
    console.error(`Couldn't email the split-up for group ${id}:`, reason);
  }
  const sent = recipients.length - failed.length;
  if (sent === 0) {
    throw new HttpError(502, "We couldn't send the email just now. Please try again shortly.", "EMAIL_FAILED");
  }

  await prisma.expenseGroup.update({ where: { id }, data: { splitEmailSentAt: new Date() } });
  await logActivity({
    actorId: admin.id,
    action: "group.split-emailed",
    summary: `Emailed the split-up for ${group.name}`,
    involved: peopleIds,
    expenseGroupId: id,
  });
  return { sent, failed: failed.length, noEmail };
}

export interface SettlementInput {
  amount: string;
  date: string;
  fromAdminUserId: bigint;
  toAdminUserId: bigint;
}

// Whoever gets the money says it arrived, so someone can't clear their own debt.
// Super admins can do it for anyone. The same rule goes for daily splits.
export function mayRecordRepayment(toId: bigint, admin: RequestingAdmin) {
  return admin.isSuperAdmin || toId === admin.id;
}

export async function addSettlement(groupId: bigint, input: SettlementInput, admin: RequestingAdmin) {
  const group = await findGroupOrThrow(groupId, admin);
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to record settlements");
  }
  if (input.fromAdminUserId === input.toAdminUserId) {
    throw BadRequestError("A settlement needs two different people");
  }
  if (!mayRecordRepayment(input.toAdminUserId, admin)) {
    throw ForbiddenError("Only the person receiving this money can mark it as paid");
  }
  await assertAdminUsersExist([input.fromAdminUserId, input.toAdminUserId]);
  const loaded = await prisma.expenseGroup.findUniqueOrThrow({ where: { id: groupId }, include: includeRelations });
  const { balances, fundHolderId } = summaryOf(loaded);
  const maxCents = maxRepaymentCents(balances, input.fromAdminUserId, input.toAdminUserId, fundHolderId);
  if (maxCents === 0) {
    throw BadRequestError("Nothing is owed between these two people");
  }
  if (Math.round(Number(input.amount) * 100) > maxCents) {
    throw BadRequestError(`Only ${(maxCents / 100).toFixed(2)} is owed here`);
  }
  await prisma.expenseGroupSettlement.create({
    data: {
      expenseGroupId: groupId,
      amount: input.amount,
      date: new Date(input.date),
      fromAdminUserId: input.fromAdminUserId,
      toAdminUserId: input.toAdminUserId,
    },
  });
  await recordRepayment("added", input, admin, group);
  return present(await prisma.expenseGroup.findUniqueOrThrow({ where: { id: groupId }, include: includeRelations }));
}

export async function deleteSettlement(groupId: bigint, settlementId: bigint, admin: RequestingAdmin) {
  const group = await findGroupOrThrow(groupId, admin);
  const existing = await prisma.expenseGroupSettlement.findUnique({ where: { id: settlementId } });
  if (!existing || existing.expenseGroupId !== groupId) {
    throw NotFoundError("Settlement not found");
  }
  if (!mayRecordRepayment(existing.toAdminUserId, admin)) {
    throw ForbiddenError("Only the person who received this money can remove it");
  }
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to change settlements");
  }
  await prisma.expenseGroupSettlement.delete({ where: { id: settlementId } });
  await recordRepayment("removed", existing, admin, group);
}
