import { prisma } from "../../lib/prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { addMissingMembers, assertGroupAccess } from "../expense-group/expense-group.service";
import { computeDirectTransfers } from "./direct-balances";
import { computeEqualShares, normalizeSplit, resolveCustomShares, type SplitShare } from "./split";
import { assertGoalAccess } from "../savings-goal/savings-goal.service";

const includeRelations = {
  category: true,
  paidBy: { select: { id: true, email: true, name: true } },
  createdBy: { select: { id: true, email: true, name: true } },
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
function involving(admin: RequestingAdmin) {
  return {
    OR: [
      { paidByAdminUserId: admin.id },
      { createdByAdminUserId: admin.id },
      { splitParticipants: { some: { adminUserId: admin.id } } },
    ],
  };
}

export async function listExpenses(admin: RequestingAdmin) {
  return prisma.expense.findMany({
    where: admin.isSuperAdmin ? undefined : involving(admin),
    include: includeRelations,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
}

// Everything in a trip/event for the people on it, who are sharing it. Someone
// who only has an expense in it, or anyone viewing an older group with no
// people recorded, still only gets the expenses they're part of.
export async function listGroupExpenses(expenseGroupId: bigint, admin: RequestingAdmin) {
  const group = await prisma.expenseGroup.findUnique({
    where: { id: expenseGroupId },
    select: { members: { select: { adminUserId: true } } },
  });
  if (!group) {
    throw NotFoundError("Trip/event not found");
  }
  await assertGroupAccess(expenseGroupId, admin);
  const seesAll = admin.isSuperAdmin || group.members.some((member) => member.adminUserId === admin.id);
  return prisma.expense.findMany({
    where: { expenseGroupId, ...(seesAll ? {} : involving(admin)) },
    include: includeRelations,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
}

// Whoever paid or logged an expense can change it. Someone who only shares it
// can see it, but can't change what it cost or remove it.
export function mayChangeExpense(
  expense: { paidByAdminUserId: bigint; createdByAdminUserId: bigint | null },
  admin: RequestingAdmin,
) {
  return admin.isSuperAdmin || expense.paidByAdminUserId === admin.id || expense.createdByAdminUserId === admin.id;
}

// A closed trip/event group is settled — its expenses are frozen so the
// settle-up balances can't silently change underneath everyone.
async function assertGroupOpen(expenseGroupId: bigint | null | undefined) {
  if (!expenseGroupId) return;
  const group = await prisma.expenseGroup.findUnique({ where: { id: expenseGroupId } });
  if (!group) {
    throw BadRequestError("That expense group no longer exists");
  }
  if (group.closedAt) {
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

// An expense can only draw from a goal the person can see, and that's open.
async function assertSavingsGoalUsable(savingsGoalId: bigint | null | undefined, admin: RequestingAdmin) {
  if (!savingsGoalId) return;
  const goal = await prisma.savingsGoal.findUnique({ where: { id: savingsGoalId } });
  if (!goal) {
    throw BadRequestError("That savings goal no longer exists");
  }
  await assertGoalAccess(savingsGoalId, admin);
  if (goal.closedAt) {
    throw BadRequestError(`Savings goal "${goal.name}" is closed`);
  }
}

// A required relation pointing at a missing category would break the whole
// expense list, as MongoDB has no foreign keys to stop it.
async function assertCategoryExists(categoryId: bigint) {
  const found = await prisma.expenseCategory.count({ where: { id: categoryId } });
  if (found === 0) {
    throw BadRequestError("That category no longer exists");
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
  // A custom split: each person's own amount, which must add up to the
  // expense. Takes the place of splitAdminUserIds when present.
  splitShares?: SplitShare[];
}

// What an expense's split should become: undefined when it isn't changing.
function resolveShares(
  input: Pick<ExpenseInput, "splitAdminUserIds" | "splitShares">,
  amount: string,
  payerId: bigint,
): SplitShare[] | undefined {
  if (input.splitShares !== undefined) return resolveCustomShares(input.splitShares, amount, payerId);
  if (input.splitAdminUserIds === undefined) return undefined;
  const ids = normalizeSplit(input.splitAdminUserIds, payerId);
  return ids.length > 0 ? computeEqualShares(amount, ids) : [];
}

async function replaceSplitParticipants(expenseId: bigint, shares: SplitShare[]) {
  await prisma.expenseSplitParticipant.deleteMany({ where: { expenseId } });
  if (shares.length === 0) return;

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
  if (input.expenseGroupId) await assertGroupAccess(input.expenseGroupId, admin);
  await assertPayerAllowed(input.paidByAdminUserId, input.expenseGroupId, admin);
  await assertSavingsGoalUsable(input.savingsGoalId, admin);
  await assertDateInGroupWindow(input.expenseGroupId, new Date(input.date));
  await assertCategoryExists(input.categoryId);
  const shares = resolveShares(input, input.amount, input.paidByAdminUserId) ?? [];
  const sharerIds = shares.map((share) => share.adminUserId);
  await assertAdminUsersExist([input.paidByAdminUserId, ...sharerIds]);
  await assertCanPick(sharerIds, admin);

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

  if (shares.length > 0) {
    await replaceSplitParticipants(created.id, shares);
  }
  if (input.expenseGroupId) {
    await addMissingMembers(input.expenseGroupId, [input.paidByAdminUserId, ...sharerIds]);
  }

  return prisma.expense.findUniqueOrThrow({ where: { id: created.id }, include: includeRelations });
}

export async function updateExpense(id: bigint, input: Partial<ExpenseInput>, admin: RequestingAdmin) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  if (!mayChangeExpense(existing, admin)) {
    throw ForbiddenError("Only the person who paid or logged this expense can change it");
  }
  await assertGroupOpen(existing.expenseGroupId);
  if (input.expenseGroupId !== undefined && input.expenseGroupId !== existing.expenseGroupId) {
    await assertGroupOpen(input.expenseGroupId);
    if (input.expenseGroupId) await assertGroupAccess(input.expenseGroupId, admin);
  }
  if (input.savingsGoalId !== undefined && input.savingsGoalId !== existing.savingsGoalId) {
    await assertSavingsGoalUsable(input.savingsGoalId, admin);
  }
  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    await assertCategoryExists(input.categoryId);
  }
  const groupId = input.expenseGroupId !== undefined ? input.expenseGroupId : existing.expenseGroupId;
  await assertDateInGroupWindow(groupId, input.date ? new Date(input.date) : existing.date);
  const payerId = input.paidByAdminUserId ?? existing.paidByAdminUserId;
  if (payerId !== existing.paidByAdminUserId || groupId !== existing.expenseGroupId) {
    await assertPayerAllowed(payerId, groupId, admin, existing.paidByAdminUserId);
  }

  // A changed amount has to re-divide an existing split even if the caller
  // didn't resend it (evenly, as a custom split's amounts no longer apply), or
  // the shares would stop adding up to the expense.
  const amount = input.amount ?? existing.amount;
  const amountChanged = Number(amount) !== Number(existing.amount);
  let splitInput: Pick<ExpenseInput, "splitAdminUserIds" | "splitShares"> = input;
  if (input.splitAdminUserIds === undefined && input.splitShares === undefined && amountChanged) {
    const participants = await prisma.expenseSplitParticipant.findMany({
      where: { expenseId: id },
      select: { adminUserId: true },
    });
    splitInput = { splitAdminUserIds: participants.map((participant) => participant.adminUserId) };
  }
  const shares = resolveShares(splitInput, amount, payerId);
  await assertAdminUsersExist([payerId, ...(shares ?? []).map((share) => share.adminUserId)]);
  if (shares !== undefined) {
    const current = await prisma.expenseSplitParticipant.findMany({
      where: { expenseId: id },
      select: { adminUserId: true },
    });
    await assertCanPick(
      shares.map((share) => share.adminUserId),
      admin,
      [existing.paidByAdminUserId, ...current.map((participant) => participant.adminUserId)],
    );
  }

  await prisma.expense.update({
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

  if (shares !== undefined) {
    await replaceSplitParticipants(id, shares);
  }
  if (groupId) {
    const participants = await prisma.expenseSplitParticipant.findMany({
      where: { expenseId: id },
      select: { adminUserId: true },
    });
    await addMissingMembers(groupId, [payerId, ...participants.map((participant) => participant.adminUserId)]);
  }

  return prisma.expense.findUniqueOrThrow({ where: { id }, include: includeRelations });
}

export async function deleteExpense(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  if (!mayChangeExpense(existing, admin)) {
    throw ForbiddenError("Only the person who paid or logged this expense can delete it");
  }
  await assertGroupOpen(existing.expenseGroupId);
  await prisma.expense.delete({ where: { id } });
}

// ── Daily splits ─────────────────────────────────────────────────────────
// Splits on expenses outside any group, settled between each pair of people.

const personSelect = { select: { id: true, email: true, name: true } } as const;

// Older expenses may have no group field at all rather than an explicit null.
const notInAGroup = { OR: [{ expenseGroupId: null }, { expenseGroupId: { isSet: false } }] };

function isParty(admin: RequestingAdmin, fromId: bigint, toId: bigint) {
  return fromId === admin.id || toId === admin.id;
}

// Each person sees what's between them and someone else — nothing about pairs
// they aren't part of. Super admins see every pair.
export async function getDirectBalances(admin: RequestingAdmin) {
  const mine = {
    OR: [
      { paidByAdminUserId: admin.id },
      { splitParticipants: { some: { adminUserId: admin.id } } },
    ],
  };
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        AND: [notInAGroup, { splitParticipants: { some: {} } }, ...(admin.isSuperAdmin ? [] : [mine])],
      },
      select: {
        paidBy: personSelect,
        splitParticipants: { select: { shareAmount: true, adminUser: personSelect } },
      },
    }),
    prisma.expenseGroupSettlement.findMany({
      where: {
        expenseGroupId: null,
        ...(admin.isSuperAdmin ? {} : { OR: [{ fromAdminUserId: admin.id }, { toAdminUserId: admin.id }] }),
      },
      include: { fromAdminUser: personSelect, toAdminUser: personSelect },
      orderBy: { date: "desc" },
    }),
  ]);
  const transfers = computeDirectTransfers(expenses, settlements).filter(
    (transfer) => admin.isSuperAdmin || isParty(admin, transfer.fromAdminUserId, transfer.toAdminUserId),
  );
  return { transfers, settlements };
}

export interface DirectSettlementInput {
  amount: string;
  date: string;
  fromAdminUserId: bigint;
  toAdminUserId: bigint;
}

export async function addDirectSettlement(input: DirectSettlementInput, admin: RequestingAdmin) {
  if (input.fromAdminUserId === input.toAdminUserId) {
    throw BadRequestError("A settlement needs two different people");
  }
  if (!admin.isSuperAdmin && !isParty(admin, input.fromAdminUserId, input.toAdminUserId)) {
    throw ForbiddenError("You can only record repayments you're part of");
  }
  await assertAdminUsersExist([input.fromAdminUserId, input.toAdminUserId]);
  // Worked out from the payer's side: that covers everything between the two.
  const { transfers } = await getDirectBalances({ id: input.fromAdminUserId, isSuperAdmin: false });
  const owed = transfers.find(
    (transfer) => transfer.fromAdminUserId === input.fromAdminUserId && transfer.toAdminUserId === input.toAdminUserId,
  );
  if (!owed) {
    throw BadRequestError("Nothing is owed between these two people");
  }
  if (Math.round(Number(input.amount) * 100) > owed.amountCents) {
    throw BadRequestError(`Only ${(owed.amountCents / 100).toFixed(2)} is owed here`);
  }
  await prisma.expenseGroupSettlement.create({
    data: {
      expenseGroupId: null,
      amount: input.amount,
      date: new Date(input.date),
      fromAdminUserId: input.fromAdminUserId,
      toAdminUserId: input.toAdminUserId,
    },
  });
  return getDirectBalances(admin);
}

export async function deleteDirectSettlement(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.expenseGroupSettlement.findUnique({ where: { id } });
  // A group's repayments go through that group, which enforces it being open.
  if (!existing || existing.expenseGroupId) {
    throw NotFoundError("Settlement not found");
  }
  if (!admin.isSuperAdmin && !isParty(admin, existing.fromAdminUserId, existing.toAdminUserId)) {
    throw ForbiddenError("You can only remove repayments you're part of");
  }
  await prisma.expenseGroupSettlement.delete({ where: { id } });
}
