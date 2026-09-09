import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";

const rawSelectFields = {
  id: true,
  email: true,
  name: true,
  isOwner: true,
  isActive: true,
  hasPortfolioAccess: true,
  hasExpensesAccess: true,
  hasInvestmentsAccess: true,
  hasSavingsAccess: true,
  passwordHash: true,
  createdAt: true,
} as const;

// passwordHash itself is never sent to the client — only whether one is set
// ("hasLogin"), which is what the UI needs to tell a login-enabled member
// apart from a guest that only exists to be picked in split/holder lists.
function toDto<T extends { passwordHash: string | null }>(row: T) {
  const { passwordHash, ...rest } = row;
  return { ...rest, hasLogin: passwordHash !== null };
}

export async function listAdminUsers() {
  const rows = await prisma.adminUser.findMany({ select: rawSelectFields, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
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
        { hasInvestmentsAccess: true },
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
  hasInvestmentsAccess: boolean;
  hasSavingsAccess: boolean;
}

export async function createAdminUser(input: CreateAdminUserInput) {
  if ((input.email && !input.password) || (!input.email && input.password)) {
    throw BadRequestError("Provide both an email and a password to grant login access, or neither for a guest member");
  }

  if (input.email) {
    const existing = await prisma.adminUser.findUnique({ where: { email: input.email } });
    if (existing) {
      throw ConflictError("An admin user with this email already exists");
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
      hasInvestmentsAccess: input.hasInvestmentsAccess,
      hasSavingsAccess: input.hasSavingsAccess,
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
  isActive?: boolean;
  hasPortfolioAccess?: boolean;
  hasExpensesAccess?: boolean;
  hasInvestmentsAccess?: boolean;
  hasSavingsAccess?: boolean;
}

export async function updateAdminUser(id: bigint, input: UpdateAdminUserInput) {
  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Admin user not found");
  }

  const nextEmail = input.email ?? existing.email;
  const nextHasPassword = input.password !== undefined || existing.passwordHash !== null;
  if (nextHasPassword && !nextEmail) {
    throw BadRequestError("An email is required to grant login access");
  }
  if (input.email) {
    const emailOwner = await prisma.adminUser.findUnique({ where: { email: input.email } });
    if (emailOwner && emailOwner.id !== id) {
      throw ConflictError("An admin user with this email already exists");
    }
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
  const updated = await prisma.adminUser.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      isActive: input.isActive,
      hasPortfolioAccess: input.hasPortfolioAccess,
      hasExpensesAccess: input.hasExpensesAccess,
      hasInvestmentsAccess: input.hasInvestmentsAccess,
      hasSavingsAccess: input.hasSavingsAccess,
    },
    select: rawSelectFields,
  });
  return toDto(updated);
}

export async function deleteAdminUser(id: bigint) {
  const existing = await prisma.adminUser.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Admin user not found");
  }
  // Soft-delete: deactivate rather than remove the row, since expenses/
  // investments/savings contributions carry a required FK to this user.
  await prisma.adminUser.update({ where: { id }, data: { isActive: false } });
}
