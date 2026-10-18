import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";

const userSelect = { select: { id: true, email: true, name: true } } as const;

const includeRelations = {
  settlements: {
    include: { fromAdminUser: userSelect, toAdminUser: userSelect },
    orderBy: { date: "desc" as const },
  },
  members: { include: { adminUser: userSelect } },
} as const;

export async function listExpenseGroups() {
  return prisma.expenseGroup.findMany({ include: includeRelations, orderBy: { createdAt: "desc" } });
}

export interface ExpenseGroupInput {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  // The people in the group. Undefined leaves them as they are on update.
  memberAdminUserIds?: bigint[];
}

async function assertMembersExist(ids: bigint[]) {
  const found = await prisma.adminUser.count({ where: { id: { in: ids } } });
  if (found !== ids.length) {
    throw BadRequestError("One of the selected people doesn't exist");
  }
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

// `creatorId` joins the group when no members are given (e.g. a group
// typed straight into the expense form's picker).
export async function createExpenseGroup(input: ExpenseGroupInput, creatorId: bigint) {
  assertValidRange(input.startDate, input.endDate);
  const memberIds = unique(input.memberAdminUserIds ?? [creatorId]);
  await assertMembersExist(memberIds);
  const created = await prisma.expenseGroup.create({
    data: {
      name: input.name,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    },
  });
  await replaceMembers(created.id, memberIds);
  return prisma.expenseGroup.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations });
}

async function findGroupOrThrow(id: bigint) {
  const existing = await prisma.expenseGroup.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Trip/event not found");
  }
  return existing;
}

export async function updateExpenseGroup(id: bigint, input: Partial<ExpenseGroupInput>) {
  const existing = await findGroupOrThrow(id);
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
    await assertMembersExist(memberIds);
    // Someone who paid for one of the group's expenses has to stay in it.
    const payers = await prisma.expense.findMany({
      where: { expenseGroupId: id, paidByAdminUserId: { notIn: memberIds } },
      select: { paidBy: { select: { name: true, email: true } } },
    });
    if (payers.length > 0) {
      const who = payers[0].paidBy.name || payers[0].paidBy.email || "Someone";
      throw BadRequestError(`${who} paid for an expense in this group, so they can't be removed from it`);
    }
    await replaceMembers(id, memberIds);
  }

  return prisma.expenseGroup.update({
    where: { id },
    data: {
      name: input.name,
      startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
    },
    include: includeRelations,
  });
}

export async function setExpenseGroupClosed(id: bigint, closed: boolean) {
  await findGroupOrThrow(id);
  return prisma.expenseGroup.update({
    where: { id },
    data: { closedAt: closed ? new Date() : null },
    include: includeRelations,
  });
}

export async function deleteExpenseGroup(id: bigint) {
  await findGroupOrThrow(id);
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

export async function addSettlement(groupId: bigint, input: SettlementInput) {
  const group = await findGroupOrThrow(groupId);
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to record settlements");
  }
  if (input.fromAdminUserId === input.toAdminUserId) {
    throw BadRequestError("A settlement needs two different people");
  }
  if (!(Number(input.amount) > 0)) {
    throw BadRequestError("Settlement amount must be greater than zero");
  }
  await prisma.expenseGroupSettlement.create({
    data: {
      expenseGroupId: groupId,
      amount: Number(input.amount).toFixed(2),
      date: new Date(input.date),
      fromAdminUserId: input.fromAdminUserId,
      toAdminUserId: input.toAdminUserId,
    },
  });
  return prisma.expenseGroup.findUniqueOrThrow({ where: { id: groupId }, include: includeRelations });
}

export async function deleteSettlement(groupId: bigint, settlementId: bigint) {
  const group = await findGroupOrThrow(groupId);
  const existing = await prisma.expenseGroupSettlement.findUnique({ where: { id: settlementId } });
  if (!existing || existing.expenseGroupId !== groupId) {
    throw NotFoundError("Settlement not found");
  }
  if (group.closedAt) {
    throw BadRequestError("This group is closed — reopen it to change settlements");
  }
  await prisma.expenseGroupSettlement.delete({ where: { id: settlementId } });
}
