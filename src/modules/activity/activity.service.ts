import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { maskEmail } from "../auth/auth-code";

export interface ActivityEntry {
  actorId: bigint;
  action: string;
  summary: string;
  involved: (bigint | null | undefined)[];
  expenseId?: bigint | null;
  expenseGroupId?: bigint | null;
  savingsGoalId?: bigint | null;
}

// Records what just happened. A history entry is never worth failing the
// change it describes, so a problem writing it is only logged.
export async function logActivity(entry: ActivityEntry) {
  const involved = [
    ...new Set(entry.involved.filter((id): id is bigint => id !== null && id !== undefined)),
  ];
  try {
    await prisma.activityLog.create({
      data: {
        actorAdminUserId: entry.actorId,
        action: entry.action,
        summary: entry.summary,
        expenseId: entry.expenseId ?? null,
        expenseGroupId: entry.expenseGroupId ?? null,
        savingsGoalId: entry.savingsGoalId ?? null,
        involvedAdminUserIds: involved,
      },
    });
  } catch (error) {
    console.error(`Couldn't record activity "${entry.action}":`, error);
  }
}

// How someone is named in a summary: their name, or a masked address.
export function displayName(person: { name: string | null; email: string | null } | null | undefined) {
  if (!person) return "Someone";
  return person.name?.trim() || (person.email ? maskEmail(person.email) : "Someone");
}

export async function namesOf(ids: (bigint | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is bigint => id !== null && id !== undefined))];
  const people = wanted.length
    ? await prisma.adminUser.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, email: true } })
    : [];
  const byId = new Map(people.map((person) => [person.id, displayName(person)]));
  return (id: bigint | null | undefined) => (id === null || id === undefined ? "Someone" : (byId.get(id) ?? "Someone"));
}

// "₹1,200" or "₹1,200.50", as the app shows amounts.
export function formatAmount(amount: string | number) {
  const value = Number(amount);
  const digits = Math.round(value * 100) % 100 !== 0 ? 2 : 0;
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// "expenses" and "savings" are those pages' history; "daily" is repayments on
// daily splits (outside any group).
export type ActivityArea = "expenses" | "savings" | "daily";

export interface ActivityFilter {
  expenseId?: bigint;
  expenseGroupId?: bigint;
  savingsGoalId?: bigint;
  area?: ActivityArea;
  limit?: number;
}

const areaWhere: Record<ActivityArea, Prisma.ActivityLogWhereInput> = {
  expenses: { savingsGoalId: null },
  savings: { savingsGoalId: { not: null } },
  daily: { expenseGroupId: null, action: { in: ["settlement.added", "settlement.removed"] } },
};

// Each person sees what they did and what concerns them. `seesAll` is for a
// record they can already see in full (a group they're in, a goal, an
// expense), where its whole history is theirs to see too; super admins always.
export async function listActivity(
  admin: { id: bigint; isSuperAdmin: boolean },
  filter: ActivityFilter = {},
  seesAll = false,
) {
  const rows = await prisma.activityLog.findMany({
    where: {
      ...(filter.expenseId ? { expenseId: filter.expenseId } : {}),
      ...(filter.expenseGroupId ? { expenseGroupId: filter.expenseGroupId } : {}),
      ...(filter.savingsGoalId ? { savingsGoalId: filter.savingsGoalId } : {}),
      ...(filter.area ? areaWhere[filter.area] : {}),
      ...(admin.isSuperAdmin || seesAll
        ? {}
        : { OR: [{ actorAdminUserId: admin.id }, { involvedAdminUserIds: { has: admin.id } }] }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(filter.limit ?? 200, 1), 500),
  });
  const name = await namesOf(rows.map((row) => row.actorAdminUserId));
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    summary: row.summary,
    expenseId: row.expenseId,
    expenseGroupId: row.expenseGroupId,
    savingsGoalId: row.savingsGoalId,
    actor: { id: row.actorAdminUserId, name: name(row.actorAdminUserId) },
  }));
}
