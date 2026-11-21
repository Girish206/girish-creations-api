import { prisma } from "../../lib/prisma";
import { BadRequestError, NotFoundError } from "../../utils/httpError";
import { assertAdminUsersExist } from "../admin-user/assert-admin-users-exist";
import { assertCanPick } from "../admin-user/connected-people";
import { assertCategoryUsable } from "../expense-category/expense-category.service";
import { createExpense, type RequestingAdmin } from "../expense/expense.service";
import { nextOccurrence, toDay, todayInIndia, type Frequency } from "./recurring-dates";

// Rent, a subscription, an EMI: an expense that repeats. Each person sees and
// changes only their own. When one is due, a real expense is added for it
// (runDueRecurring) — the next time its owner opens the app.

export interface RecurringInput {
  amount: string;
  description?: string | null;
  categoryId: bigint;
  frequency: Frequency;
  // The first date it's due ("YYYY-MM-DD"); today or later.
  startDate: string;
  endDate?: string | null;
  splitAdminUserIds?: bigint[];
  active?: boolean;
}

const categorySelect = { select: { id: true, name: true, iconType: true, icon: true } } as const;

async function present(row: Awaited<ReturnType<typeof prisma.recurringExpense.findUniqueOrThrow>>) {
  const [category, people] = await Promise.all([
    prisma.expenseCategory.findUnique({ where: { id: row.categoryId }, ...categorySelect }),
    row.splitAdminUserIds.length
      ? prisma.adminUser.findMany({ where: { id: { in: row.splitAdminUserIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  return { ...row, category, splitWith: people };
}

export async function listRecurring(admin: RequestingAdmin) {
  const rows = await prisma.recurringExpense.findMany({
    where: { ownerAdminUserId: admin.id },
    orderBy: [{ active: "desc" }, { nextDate: "asc" }],
  });
  return Promise.all(rows.map(present));
}

async function findOwnOrThrow(id: bigint, admin: RequestingAdmin) {
  const row = await prisma.recurringExpense.findUnique({ where: { id } });
  // Someone else's is "not found": they shouldn't learn it exists.
  if (!row || row.ownerAdminUserId !== admin.id) throw NotFoundError("Recurring expense not found");
  return row;
}

async function assertSplitAllowed(ids: bigint[], admin: RequestingAdmin) {
  const others = ids.filter((id) => id !== admin.id);
  if (others.length === 0) return [];
  await assertAdminUsersExist(others);
  await assertCanPick(others, admin);
  return [...new Set(others)];
}

function assertDates(startDate: string, endDate: string | null | undefined) {
  if (endDate && endDate.slice(0, 10) < startDate.slice(0, 10)) {
    throw BadRequestError("The end date has to be on or after the start date");
  }
}

export async function createRecurring(input: RecurringInput, admin: RequestingAdmin) {
  await assertCategoryUsable(input.categoryId, admin);
  assertDates(input.startDate, input.endDate);
  const split = await assertSplitAllowed(input.splitAdminUserIds ?? [], admin);
  const start = input.startDate.slice(0, 10);
  const created = await prisma.recurringExpense.create({
    data: {
      ownerAdminUserId: admin.id,
      amount: input.amount,
      description: input.description?.trim() || null,
      categoryId: input.categoryId,
      frequency: input.frequency,
      dayOfMonth: input.frequency === "monthly" ? Number(start.slice(8, 10)) : null,
      nextDate: new Date(start),
      endDate: input.endDate ? new Date(input.endDate.slice(0, 10)) : null,
      splitAdminUserIds: split,
      active: input.active ?? true,
    },
  });
  await runDueRecurring(admin);
  return present(await prisma.recurringExpense.findUniqueOrThrow({ where: { id: created.id } }));
}

export async function updateRecurring(id: bigint, input: Partial<RecurringInput>, admin: RequestingAdmin) {
  const existing = await findOwnOrThrow(id, admin);
  if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
    await assertCategoryUsable(input.categoryId, admin);
  }
  const start = input.startDate?.slice(0, 10) ?? toDay(existing.nextDate);
  const end = input.endDate !== undefined ? input.endDate : existing.endDate && toDay(existing.endDate);
  assertDates(start, end);
  const frequency = input.frequency ?? (existing.frequency as Frequency);
  const split = input.splitAdminUserIds !== undefined ? await assertSplitAllowed(input.splitAdminUserIds, admin) : undefined;
  await prisma.recurringExpense.update({
    where: { id },
    data: {
      amount: input.amount,
      description: input.description !== undefined ? input.description?.trim() || null : undefined,
      categoryId: input.categoryId,
      frequency,
      // A new start date is where it next falls (and its day of the month).
      ...(input.startDate || input.frequency
        ? { nextDate: new Date(start), dayOfMonth: frequency === "monthly" ? Number(start.slice(8, 10)) : null }
        : {}),
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate.slice(0, 10)) : null) : undefined,
      splitAdminUserIds: split,
      active: input.active,
    },
  });
  await runDueRecurring(admin);
  return present(await prisma.recurringExpense.findUniqueOrThrow({ where: { id } }));
}

// Stops it repeating. Expenses it already added stay.
export async function deleteRecurring(id: bigint, admin: RequestingAdmin) {
  await findOwnOrThrow(id, admin);
  await prisma.recurringExpense.delete({ where: { id } });
}

// Most expenses one recurring entry adds in one go: two years of a monthly
// one, for someone who hasn't opened the app in a long time.
const MAX_CATCH_UP = 104;

// Adds an expense for every date one of this person's recurring expenses was
// due, up to today. Each date is claimed first (moving nextDate on only if
// it's still the date we read), so two requests at once can't add it twice.
// Never fails the request that triggered it: a problem is only logged.
export async function runDueRecurring(admin: RequestingAdmin) {
  try {
    const today = todayInIndia();
    const due = await prisma.recurringExpense.findMany({
      where: { ownerAdminUserId: admin.id, active: true, nextDate: { lte: new Date(today) } },
    });
    for (const row of due) {
      let day = toDay(row.nextDate);
      const end = row.endDate ? toDay(row.endDate) : null;
      for (let i = 0; i < MAX_CATCH_UP && day <= today; i += 1) {
        if (end && day > end) {
          await prisma.recurringExpense.updateMany({ where: { id: row.id }, data: { active: false } });
          break;
        }
        const next = nextOccurrence(day, row.frequency as Frequency, row.dayOfMonth);
        const claimed = await prisma.recurringExpense.updateMany({
          where: { id: row.id, nextDate: new Date(day) },
          data: { nextDate: new Date(next), ...(end && next > end ? { active: false } : {}) },
        });
        if (claimed.count === 0) break;
        await createExpense(
          {
            amount: row.amount,
            date: day,
            description: row.description,
            categoryId: row.categoryId,
            paidByAdminUserId: admin.id,
            splitAdminUserIds: row.splitAdminUserIds.length ? [admin.id, ...row.splitAdminUserIds] : undefined,
            recurringExpenseId: row.id,
          },
          { id: admin.id, isSuperAdmin: false },
        );
        day = next;
      }
    }
  } catch (error) {
    console.error("Couldn't add due recurring expenses:", error);
  }
}
