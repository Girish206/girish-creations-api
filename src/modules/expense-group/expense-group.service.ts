import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { maxRepaymentCents, summarizeGroup } from "./group-balances";

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
      splitParticipants: { select: { shareAmount: true, adminUser: userSelect } },
    },
  },
} as const;

type LoadedGroup = Prisma.ExpenseGroupGetPayload<{ include: typeof includeRelations }>;

function present({ expenses, ...group }: LoadedGroup) {
  return { ...group, ...summarizeGroup(expenses, group.settlements) };
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
    },
  });
  await replaceMembers(created.id, memberIds);
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

// People with money recorded against a group can't be taken out of it —
// their paid amounts, shares or repayments would still count in its balances.
async function assertNotRemovingInvolvedPeople(id: bigint, memberIds: bigint[]) {
  const [payer, sharer, settlement] = await Promise.all([
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
}

// Everyone on a group already: its members, plus anyone with money in it (an
// older group has no members recorded, only those).
async function peopleInGroup(id: bigint) {
  const group = await prisma.expenseGroup.findUniqueOrThrow({ where: { id }, include: includeRelations });
  return [
    ...group.members.map((member) => member.adminUserId),
    ...summarizeGroup(group.expenses, group.settlements).balances.map((balance) => balance.adminUserId),
  ];
}

export async function updateExpenseGroup(id: bigint, input: Partial<ExpenseGroupInput>, admin: RequestingAdmin) {
  const existing = await findGroupOrThrow(id, admin);
  const startDate = input.startDate !== undefined ? input.startDate : existing.startDate && dayOf(existing.startDate);
  const endDate = input.endDate !== undefined ? input.endDate : existing.endDate && dayOf(existing.endDate);
  assertValidRange(startDate, endDate);

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

  return present(
    await prisma.expenseGroup.update({
      where: { id },
      data: {
        name: input.name,
        startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
        endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
      },
      include: includeRelations,
    }),
  );
}

export async function setExpenseGroupClosed(id: bigint, closed: boolean, admin: RequestingAdmin) {
  await findGroupOrThrow(id, admin);
  return present(
    await prisma.expenseGroup.update({
      where: { id },
      data: { closedAt: closed ? new Date() : null },
      include: includeRelations,
    }),
  );
}

export async function deleteExpenseGroup(id: bigint, admin: RequestingAdmin) {
  await findGroupOrThrow(id, admin);
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
}

export interface SettlementInput {
  amount: string;
  date: string;
  fromAdminUserId: bigint;
  toAdminUserId: bigint;
}

// A repayment is between two people, the same rule as for daily splits.
export function mayRecordRepayment(fromId: bigint, toId: bigint, admin: RequestingAdmin) {
  return admin.isSuperAdmin || fromId === admin.id || toId === admin.id;
}

export async function addSettlement(groupId: bigint, input: SettlementInput, admin: RequestingAdmin) {
  const group = await findGroupOrThrow(groupId, admin);
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to record settlements");
  }
  if (input.fromAdminUserId === input.toAdminUserId) {
    throw BadRequestError("A settlement needs two different people");
  }
  if (!mayRecordRepayment(input.fromAdminUserId, input.toAdminUserId, admin)) {
    throw ForbiddenError("You can only record repayments you're part of");
  }
  await assertAdminUsersExist([input.fromAdminUserId, input.toAdminUserId]);
  const loaded = await prisma.expenseGroup.findUniqueOrThrow({ where: { id: groupId }, include: includeRelations });
  const { balances } = summarizeGroup(loaded.expenses, loaded.settlements);
  const maxCents = maxRepaymentCents(balances, input.fromAdminUserId, input.toAdminUserId);
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
  return present(await prisma.expenseGroup.findUniqueOrThrow({ where: { id: groupId }, include: includeRelations }));
}

export async function deleteSettlement(groupId: bigint, settlementId: bigint, admin: RequestingAdmin) {
  const group = await findGroupOrThrow(groupId, admin);
  const existing = await prisma.expenseGroupSettlement.findUnique({ where: { id: settlementId } });
  if (!existing || existing.expenseGroupId !== groupId) {
    throw NotFoundError("Settlement not found");
  }
  if (!mayRecordRepayment(existing.fromAdminUserId, existing.toAdminUserId, admin)) {
    throw ForbiddenError("You can only remove repayments you're part of");
  }
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to change settlements");
  }
  await prisma.expenseGroupSettlement.delete({ where: { id: settlementId } });
}
