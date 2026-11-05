import { prisma } from "../../lib/prisma";
import { ForbiddenError } from "../../utils/httpError";

// Who someone may pick for a split, group or savings goal: people they added,
// whoever added them and the others that person added, and anyone they already
// share a group, goal, expense or repayment with. It stops a member listing
// every account, or putting a debt on a stranger.
export async function connectedPeopleIds(adminId: bigint): Promise<Set<bigint>> {
  const me = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { createdByAdminUserId: true } });
  const addedBy = me?.createdByAdminUserId ?? null;
  const mine = { adminUserId: adminId };

  const [added, groupMembers, goals, expenses, settlements] = await Promise.all([
    prisma.adminUser.findMany({
      where: { createdByAdminUserId: { in: addedBy ? [adminId, addedBy] : [adminId] } },
      select: { id: true },
    }),
    prisma.expenseGroupMember.findMany({
      where: { expenseGroup: { members: { some: mine } } },
      select: { adminUserId: true },
    }),
    prisma.savingsGoal.findMany({
      where: {
        OR: [
          { createdByAdminUserId: adminId },
          { accountHolderAdminUserId: adminId },
          { members: { some: mine } },
          { contributions: { some: { contributedByAdminUserId: adminId } } },
        ],
      },
      select: {
        createdByAdminUserId: true,
        accountHolderAdminUserId: true,
        members: { select: { adminUserId: true } },
        contributions: { select: { contributedByAdminUserId: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        OR: [{ paidByAdminUserId: adminId }, { createdByAdminUserId: adminId }, { splitParticipants: { some: mine } }],
      },
      select: {
        paidByAdminUserId: true,
        createdByAdminUserId: true,
        splitParticipants: { select: { adminUserId: true } },
      },
    }),
    prisma.expenseGroupSettlement.findMany({
      where: { OR: [{ fromAdminUserId: adminId }, { toAdminUserId: adminId }] },
      select: { fromAdminUserId: true, toAdminUserId: true },
    }),
  ]);

  const ids = new Set<bigint>([adminId]);
  const add = (id: bigint | null | undefined) => {
    if (id !== null && id !== undefined) ids.add(id);
  };
  add(addedBy);
  added.forEach((person) => add(person.id));
  groupMembers.forEach((member) => add(member.adminUserId));
  for (const goal of goals) {
    add(goal.createdByAdminUserId);
    add(goal.accountHolderAdminUserId);
    goal.members.forEach((member) => add(member.adminUserId));
    goal.contributions.forEach((contribution) => add(contribution.contributedByAdminUserId));
  }
  for (const expense of expenses) {
    add(expense.paidByAdminUserId);
    add(expense.createdByAdminUserId);
    expense.splitParticipants.forEach((participant) => add(participant.adminUserId));
  }
  for (const settlement of settlements) {
    add(settlement.fromAdminUserId);
    add(settlement.toAdminUserId);
  }
  return ids;
}

// `alreadyOn` is who's on the record being edited: they can stay on it.
export async function assertCanPick(
  ids: bigint[],
  admin: { id: bigint; isSuperAdmin: boolean },
  alreadyOn: (bigint | null | undefined)[] = [],
) {
  if (admin.isSuperAdmin) return;
  const toCheck = ids.filter((id) => !alreadyOn.includes(id));
  if (toCheck.length === 0) return;
  const connected = await connectedPeopleIds(admin.id);
  if (toCheck.some((id) => !connected.has(id))) {
    throw ForbiddenError("You can only add people you've added or already share expenses or savings with");
  }
}
