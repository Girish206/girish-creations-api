import { prisma } from "../../lib/prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { addMissingMembers, assertGroupAccess, mayRecordRepayment } from "../expense-group/expense-group.service";
import { computeDirectTransfers } from "./direct-balances";
import { computeEqualShares, normalizeSplit, resolveCustomShares, type SplitShare } from "./split";
import { assertGoalAccess } from "../savings-goal/savings-goal.service";
import { isSharedFund } from "../savings-goal/fund-split";
import { formatAmount, logActivity, namesOf } from "../activity/activity.service";
import { recordRepayment } from "../activity/repayments";
import { sendNotices } from "../activity/money-email";
import { assertCategoryUsable } from "../expense-category/expense-category.service";

const includeRelations = {
  category: true,
  paidBy: { select: { id: true, email: true, name: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  savingsGoal: { select: { id: true, name: true, kind: true } },
  expenseGroup: { select: { id: true, name: true } },
  splitParticipants: {
    include: { adminUser: { select: { id: true, email: true, name: true } } },
  },
} as const;

export interface RequestingAdmin {
  id: bigint;
  isSuperAdmin: boolean;
}

function loadExpense(id: bigint) {
  return prisma.expense.findUniqueOrThrow({ where: { id }, include: includeRelations });
}

type LoadedExpense = Awaited<ReturnType<typeof loadExpense>>;

// "Dinner" (₹1,200), or just the amount when there's no description.
function expenseLabel(expense: { description: string | null; amount: string }) {
  const description = expense.description?.trim();
  return description
    ? `"${description}" (${formatAmount(expense.amount)})`
    : `an expense of ${formatAmount(expense.amount)}`;
}

const inGroup = (expense: LoadedExpense) => (expense.expenseGroup ? ` in ${expense.expenseGroup.name}` : "");

function peopleOn(expense: {
  paidByAdminUserId: bigint;
  createdByAdminUserId: bigint | null;
  splitParticipants: { adminUserId: bigint }[];
}) {
  return [
    expense.paidByAdminUserId,
    expense.createdByAdminUserId,
    ...expense.splitParticipants.map((participant) => participant.adminUserId),
  ];
}

// Tells each person whose share is new or different what they now owe, so
// nobody is put on a split without knowing. `before` is each share as it was.
async function notifyShares(expense: LoadedExpense, admin: RequestingAdmin, before = new Map<bigint, string>()) {
  const changed = expense.splitParticipants.filter(
    (participant) => before.get(participant.adminUserId) !== participant.shareAmount,
  );
  if (changed.length === 0) return;
  const name = await namesOf([admin.id, expense.paidByAdminUserId]);
  const actor = name(admin.id);
  const shareOf = new Map(changed.map((participant) => [participant.adminUserId, participant.shareAmount]));
  await sendNotices(
    changed.map((participant) => participant.adminUserId),
    admin.id,
    (recipient) => {
      const share = shareOf.get(recipient.id);
      if (share === undefined) return null;
      const paidByThem = expense.paidByAdminUserId === recipient.id;
      const wasOn = before.has(recipient.id);
      return {
        subject: wasOn ? `${actor} changed your share of an expense` : `${actor} split an expense with you`,
        lines: [
          `${actor} ${wasOn ? "changed your share of" : "added you to"} ${expenseLabel(expense)}${inGroup(expense)}.`,
          paidByThem
            ? "You're down as the one who paid it."
            : 'If your share isn\'t right, open the expense in Girish Creations and choose "This isn\'t right" so they know.',
        ],
        details: [
          { label: "Date", value: expense.date.toISOString().slice(0, 10) },
          { label: "Total", value: formatAmount(expense.amount) },
          { label: "Paid by", value: paidByThem ? "You" : name(expense.paidByAdminUserId) },
          { label: "Your share", value: formatAmount(share) },
        ],
        footer: "You're receiving this because an expense was split with you.",
        reference: `expense-share-${expense.id}`,
      };
    },
  );
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

// Whether someone can see this expense: they're on it, they're in its group
// (who see all of a group's expenses), or they're a super admin.
export async function canSeeExpense(id: bigint, admin: RequestingAdmin) {
  if (admin.isSuperAdmin) return true;
  const expense = await prisma.expense.findFirst({
    where: { id },
    select: { expenseGroupId: true, paidByAdminUserId: true, createdByAdminUserId: true, splitParticipants: { select: { adminUserId: true } } },
  });
  if (!expense) return false;
  if (peopleOn(expense).includes(admin.id)) return true;
  if (!expense.expenseGroupId) return false;
  const member = await prisma.expenseGroupMember.count({
    where: { expenseGroupId: expense.expenseGroupId, adminUserId: admin.id },
  });
  return member > 0;
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
  // Anyone on a shared fund's trip can pay from the fund, even if they aren't
  // on the fund itself (they were added to the trip later).
  const onFundTrip = await prisma.expenseGroupMember.count({
    where: { adminUserId: admin.id, expenseGroup: { fundGoalId: savingsGoalId } },
  });
  if (onFundTrip === 0) await assertGoalAccess(savingsGoalId, admin);
  if (goal.closedAt) {
    throw BadRequestError(`Savings goal "${goal.name}" is closed`);
  }
}


// A shared fund pays for its own trip: money from it goes in that trip's group
// (filled in when no group is given), and an expense in the trip is paid either
// from its fund or from the payer's own money. Returns the group to use.
async function groupForFund(savingsGoalId: bigint | null, expenseGroupId: bigint | null) {
  if (savingsGoalId) {
    const goal = await prisma.savingsGoal.findUnique({
      where: { id: savingsGoalId },
      select: { name: true, fundGroups: { select: { id: true, name: true }, take: 1 } },
    });
    const trip = goal?.fundGroups[0];
    if (trip) {
      if (expenseGroupId === null) return trip.id;
      if (expenseGroupId !== trip.id) {
        throw BadRequestError(`Money from ${goal!.name} is for ${trip.name}, so put the expense in that group`);
      }
      return expenseGroupId;
    }
  }
  if (expenseGroupId) {
    const group = await prisma.expenseGroup.findUnique({
      where: { id: expenseGroupId },
      select: { name: true, fundGoalId: true, fundGoal: { select: { name: true } } },
    });
    if (group?.fundGoalId && savingsGoalId && savingsGoalId !== group.fundGoalId) {
      throw BadRequestError(
        `Expenses in ${group.name} are paid from ${group.fundGoal?.name ?? "its fund"} or the payer's own money`,
      );
    }
  }
  return expenseGroupId;
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

export async function createExpense(given: ExpenseInput, admin: RequestingAdmin) {
  const input = {
    ...given,
    expenseGroupId: await groupForFund(given.savingsGoalId ?? null, given.expenseGroupId ?? null),
  };
  await assertGroupOpen(input.expenseGroupId);
  if (input.expenseGroupId) await assertGroupAccess(input.expenseGroupId, admin);
  await assertPayerAllowed(input.paidByAdminUserId, input.expenseGroupId, admin);
  await assertSavingsGoalUsable(input.savingsGoalId, admin);
  await assertDateInGroupWindow(input.expenseGroupId, new Date(input.date));
  await assertCategoryUsable(input.categoryId, admin);
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

  const loaded = await loadExpense(created.id);
  await logActivity({
    actorId: admin.id,
    action: "expense.created",
    summary: `Added ${expenseLabel(loaded)}${inGroup(loaded)}`,
    involved: peopleOn(loaded),
    expenseGroupId: loaded.expenseGroupId,
    expenseId: loaded.id,
  });
  await notifyShares(loaded, admin);
  return loaded;
}

export async function updateExpense(id: bigint, given: Partial<ExpenseInput>, admin: RequestingAdmin) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  const input = { ...given };
  if (given.savingsGoalId !== undefined || given.expenseGroupId !== undefined) {
    const nextGoal = given.savingsGoalId !== undefined ? given.savingsGoalId : existing.savingsGoalId;
    const nextGroup = given.expenseGroupId !== undefined ? given.expenseGroupId : existing.expenseGroupId;
    const fitted = await groupForFund(nextGoal ?? null, nextGroup ?? null);
    if (fitted !== nextGroup) input.expenseGroupId = fitted;
  }
  if (!mayChangeExpense(existing, admin)) {
    throw ForbiddenError("Only the person who paid or logged this expense can change it");
  }
  const sharesBefore = await prisma.expenseSplitParticipant.findMany({
    where: { expenseId: id },
    select: { adminUserId: true, shareAmount: true },
  });
  await assertGroupOpen(existing.expenseGroupId);
  if (input.expenseGroupId !== undefined && input.expenseGroupId !== existing.expenseGroupId) {
    await assertGroupOpen(input.expenseGroupId);
    if (input.expenseGroupId) await assertGroupAccess(input.expenseGroupId, admin);
  }
  if (input.savingsGoalId !== undefined && input.savingsGoalId !== existing.savingsGoalId) {
    await assertSavingsGoalUsable(input.savingsGoalId, admin);
  }
  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    await assertCategoryUsable(input.categoryId, admin);
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

  const loaded = await loadExpense(id);
  await logActivity({
    actorId: admin.id,
    action: "expense.updated",
    summary: `Changed ${expenseLabel(loaded)}${inGroup(loaded)}`,
    involved: [...peopleOn(loaded), ...sharesBefore.map((share) => share.adminUserId)],
    expenseGroupId: loaded.expenseGroupId,
    expenseId: loaded.id,
  });
  await notifyShares(loaded, admin, new Map(sharesBefore.map((share) => [share.adminUserId, share.shareAmount])));
  return loaded;
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
  const loaded = await loadExpense(id);
  await prisma.expense.delete({ where: { id } });
  await logActivity({
    actorId: admin.id,
    action: "expense.deleted",
    summary: `Deleted ${expenseLabel(loaded)}${inGroup(loaded)}`,
    involved: peopleOn(loaded),
    expenseGroupId: loaded.expenseGroupId,
    expenseId: loaded.id,
  });
}

// Someone who shares an expense says their share isn't right (or takes that
// back). It doesn't change any amounts: it tells whoever paid and logged it,
// who can fix the split. Changing the split clears it.
export async function setExpenseDispute(
  id: bigint,
  disputed: boolean,
  note: string | null | undefined,
  admin: RequestingAdmin,
) {
  const existing = await prisma.expense.findUnique({ where: { id }, include: includeRelations });
  if (!existing) {
    throw NotFoundError("Expense not found");
  }
  const share = existing.splitParticipants.find((participant) => participant.adminUserId === admin.id);
  if (!share || existing.paidByAdminUserId === admin.id) {
    throw ForbiddenError("Only someone who shares this expense can say their share isn't right");
  }
  const cleanNote = disputed ? note?.trim() || null : null;
  if (Boolean(share.disputedAt) === disputed && cleanNote === share.disputeNote) {
    return existing;
  }
  await prisma.expenseSplitParticipant.update({
    where: { id: share.id },
    data: { disputedAt: disputed ? new Date() : null, disputeNote: cleanNote },
  });
  const loaded = await loadExpense(id);
  await logActivity({
    actorId: admin.id,
    action: disputed ? "expense.disputed" : "expense.dispute-withdrawn",
    summary: disputed
      ? `Said their share of ${expenseLabel(loaded)} isn't right${cleanNote ? `: ${cleanNote}` : ""}`
      : `Took back their objection to ${expenseLabel(loaded)}`,
    involved: peopleOn(loaded),
    expenseGroupId: loaded.expenseGroupId,
    expenseId: loaded.id,
  });
  const name = await namesOf([admin.id]);
  const who = name(admin.id);
  await sendNotices(
    [loaded.paidByAdminUserId, ...(loaded.createdByAdminUserId ? [loaded.createdByAdminUserId] : [])],
    admin.id,
    () => ({
      subject: disputed ? `${who} says their share isn't right` : `${who} is fine with their share now`,
      lines: disputed
        ? [
            `${who} says their share of ${expenseLabel(loaded)}${inGroup(loaded)} isn't right.`,
            ...(cleanNote ? [`They said: "${cleanNote}"`] : []),
            "Open the expense to check the split. Changing it clears this.",
          ]
        : [`${who} took back their objection to ${expenseLabel(loaded)}${inGroup(loaded)}.`],
      details: [{ label: "Their share", value: formatAmount(share.shareAmount) }],
      footer: "You're receiving this because you paid or logged this expense.",
      reference: `expense-dispute-${loaded.id}`,
    }),
  );
  return loaded;
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
        savingsGoal: { select: { kind: true } },
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
  // A shared fund paid these, and is settled on its own, so nobody owes the
  // person who logged them.
  const owed = expenses.filter((expense) => !isSharedFund(expense.savingsGoal));
  const transfers = computeDirectTransfers(owed, settlements).filter(
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
  if (!mayRecordRepayment(input.toAdminUserId, admin)) {
    throw ForbiddenError("Only the person receiving this money can mark it as paid");
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
  await recordRepayment("added", input, admin);
  return getDirectBalances(admin);
}

export async function deleteDirectSettlement(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.expenseGroupSettlement.findUnique({ where: { id } });
  // A group's repayments go through that group, which enforces it being open.
  if (!existing || existing.expenseGroupId) {
    throw NotFoundError("Settlement not found");
  }
  if (!mayRecordRepayment(existing.toAdminUserId, admin)) {
    throw ForbiddenError("Only the person who received this money can remove it");
  }
  await prisma.expenseGroupSettlement.delete({ where: { id } });
  await recordRepayment("removed", existing, admin);
}
