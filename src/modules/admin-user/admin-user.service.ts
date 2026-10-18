import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";

const rawSelectFields = {
  id: true,
  email: true,
  name: true,
  isOwner: true,
  isSuperAdmin: true,
  isActive: true,
  hasPortfolioAccess: true,
  hasExpensesAccess: true,
  hasSavingsAccess: true,
  passwordHash: true,
  createdAt: true,
} as const;

// Everything that points at an admin user. A user with none of these can be
// deleted outright; otherwise they can only be deactivated.
const linkedRecordCounts = {
  expensesPaid: true,
  savingsContributions: true,
  savingsAccountsHeld: true,
  savingsGoalsCreated: true,
  expenseSplitShares: true,
  savingsGoalMemberships: true,
  settlementsPaid: true,
  settlementsReceived: true,
} as const;

type LinkedCounts = Record<keyof typeof linkedRecordCounts, number>;

function totalLinked(counts: LinkedCounts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

// passwordHash itself is never sent to the client — only whether one is set
// ("hasLogin"), which is what the UI needs to tell a login-enabled member
// apart from a guest that only exists to be picked in split/holder lists.
function toDto<T extends { passwordHash: string | null; isOwner: boolean; isSuperAdmin: boolean }>(row: T) {
  const { passwordHash, ...rest } = row;
  // The owner is always a super admin, whatever the stored flag says.
  return { ...rest, isSuperAdmin: row.isOwner || row.isSuperAdmin, hasLogin: passwordHash !== null };
}

export interface ActingAdmin {
  id: bigint;
  isOwner: boolean;
}

// Only the owner hands out super admin, so a super admin can't promote
// others (or themselves back after a demotion).
function assertCanSetSuperAdmin(actor: ActingAdmin, value: boolean | undefined) {
  if (value !== undefined && !actor.isOwner) {
    throw ForbiddenError("Only the owner can change who is a super admin");
  }
}

export async function listAdminUsers() {
  const rows = await prisma.adminUser.findMany({
    select: { ...rawSelectFields, _count: { select: linkedRecordCounts } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ _count, ...row }) => ({ ...toDto(row), linkedRecords: totalLinked(_count) }));
}

// Minimal, non-owner-gated listing of people who should appear in "who"
// pickers (savings account holder, expense split participants): active
// login-enabled members with at least one expense-related access flag, plus
// every guest (no login at all — they exist purely to be listed).
export async function listExpenseMembers() {
  return prisma.adminUser.findMany({
    where: {
      isActive: true,
      OR: [
        { hasExpensesAccess: true },
        { hasSavingsAccess: true },
        { passwordHash: null },
      ],
    },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

export interface CreateAdminUserInput {
  // Omit both email and password to add a guest — listed as a member but
  // unable to log in. Provide both together to create a full account.
  email?: string | null;
  password?: string | null;
  name?: string | null;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
  isSuperAdmin?: boolean;
}

export async function createAdminUser(input: CreateAdminUserInput, actor: ActingAdmin) {
  assertCanSetSuperAdmin(actor, input.isSuperAdmin ? true : undefined);
  if ((input.email && !input.password) || (!input.email && input.password)) {
    throw BadRequestError("Provide both an email and a password to grant login access, or neither for a guest member");
  }

  if (input.email) {
    const existing = await prisma.adminUser.findUnique({ where: { email: input.email } });
    if (existing) {
      // Deleting an account only deactivates it (see deleteAdminUser), so
      // re-adding the same person lands here — point at the fix.
      throw ConflictError(
        existing.isActive
          ? "An admin user with this email already exists"
          : "This email belongs to a deactivated account. Edit that account and tick Active to restore it.",
      );
    }
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const created = await prisma.adminUser.create({
    data: {
      email: input.email || null,
      passwordHash,
      name: input.name,
      hasPortfolioAccess: input.hasPortfolioAccess,
      hasExpensesAccess: input.hasExpensesAccess,
      hasSavingsAccess: input.hasSavingsAccess,
      isSuperAdmin: input.isSuperAdmin ?? false,
    },
    select: rawSelectFields,
  });
  return toDto(created);
}

export interface UpdateAdminUserInput {
  name?: string | null;
  // Set together to grant login access to a guest, or to change a login
  // member's email. Password alone (existing email) just rotates it.
  email?: string;
  password?: string;
  // Turns a login member back into a guest (password cleared, email kept
  // so login can be granted again later with just a new password).
  removeLogin?: boolean;
  isActive?: boolean;
  hasPortfolioAccess?: boolean;
  hasExpensesAccess?: boolean;
  hasSavingsAccess?: boolean;
  isSuperAdmin?: boolean;
}

export async function updateAdminUser(id: bigint, input: UpdateAdminUserInput, actor: ActingAdmin) {
  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Admin user not found");
  }
  // Changing the owner's email or password would hand over the account.
  if (existing.isOwner && !actor.isOwner) {
    throw ForbiddenError("Only the owner can edit the owner account");
  }
  const superAdminChange =
    input.isSuperAdmin !== undefined && input.isSuperAdmin !== (existing.isOwner || existing.isSuperAdmin)
      ? input.isSuperAdmin
      : undefined;
  assertCanSetSuperAdmin(actor, superAdminChange);
  if (existing.isOwner && superAdminChange === false) {
    throw BadRequestError("The owner is always a super admin");
  }

  if (existing.isOwner && (input.isActive === false || input.removeLogin)) {
    throw BadRequestError("The owner account can't be deactivated or lose login access");
  }
  if (input.removeLogin && input.password) {
    throw BadRequestError("Choose either a new password or removing login, not both");
  }

  const nextEmail = input.email ?? existing.email;
  const nextHasPassword = !input.removeLogin && (input.password !== undefined || existing.passwordHash !== null);
  if (nextHasPassword && !nextEmail) {
    throw BadRequestError("An email is required to grant login access");
  }
  if (input.email) {
    const emailOwner = await prisma.adminUser.findUnique({ where: { email: input.email } });
    if (emailOwner && emailOwner.id !== id) {
      throw ConflictError("An admin user with this email already exists");
    }
  }

  const passwordHash = input.removeLogin
    ? null
    : input.password
      ? await bcrypt.hash(input.password, 10)
      : undefined;
  const updated = await prisma.adminUser.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      isActive: input.isActive,
      hasPortfolioAccess: input.hasPortfolioAccess,
      hasExpensesAccess: input.hasExpensesAccess,
      hasSavingsAccess: input.hasSavingsAccess,
      isSuperAdmin: existing.isOwner ? undefined : superAdminChange,
    },
    select: rawSelectFields,
  });
  return toDto(updated);
}

export async function deleteAdminUser(id: bigint, permanent = false) {
  const existing = await prisma.adminUser.findUnique({
    where: { id },
    include: { _count: { select: linkedRecordCounts } },
  });
  if (!existing) {
    throw NotFoundError("Admin user not found");
  }
  if (existing.isOwner) {
    throw BadRequestError("The owner account can't be deactivated or deleted");
  }
  if (permanent) {
    const hasPortfolio = (await prisma.userProfile.count({ where: { adminUserId: id } })) > 0;
    if (totalLinked(existing._count) > 0 || hasPortfolio) {
      throw ConflictError(
        "This person has a portfolio, expenses, savings or other records, so they can only be deactivated",
      );
    }
    await prisma.adminUser.delete({ where: { id } });
    return;
  }
  // Soft-delete: deactivate rather than remove the row, since expenses/
  // savings contributions carry a required FK to this user.
  await prisma.adminUser.update({ where: { id }, data: { isActive: false } });
}
