import type { AdminUser } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { EmailError, isEmailEnabled, sendEmail } from "../../lib/email";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError } from "../../utils/httpError";
import { maskEmail } from "../auth/auth-code";
import { connectedPeopleIds } from "./connected-people";
import { buildWelcomeEmail } from "./welcome-email";

const rawSelectFields = {
  id: true,
  email: true,
  mobile: true,
  name: true,
  isOwner: true,
  isSuperAdmin: true,
  isActive: true,
  hasPortfolioAccess: true,
  hasExpensesAccess: true,
  hasSavingsAccess: true,
  passwordHash: true,
  listedInAdmin: true,
  welcomeEmailSentAt: true,
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
  expenseGroupMemberships: true,
  expensesCreated: true,
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
  // (Internal to working out who belongs in the Money Hub.)
  delete (rest as { listedInAdmin?: unknown }).listedInAdmin;
  // The owner is always a super admin, whatever the stored flag says.
  return { ...rest, isSuperAdmin: row.isOwner || row.isSuperAdmin, hasLogin: passwordHash !== null };
}

export interface ActingAdmin {
  id: bigint;
  isOwner: boolean;
  isSuperAdmin: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
}

// A member without super admin may only add people for the Money Hub: no
// portfolio access, no super admin, and at most the expense/savings access
// they have themselves.
function assertMemberGrant(
  actor: ActingAdmin,
  flags: {
    hasPortfolioAccess?: boolean;
    hasExpensesAccess?: boolean;
    hasSavingsAccess?: boolean;
    isSuperAdmin?: boolean;
  },
) {
  if (actor.isSuperAdmin) return;
  if (flags.hasPortfolioAccess || flags.isSuperAdmin) {
    throw ForbiddenError("Only super admins can grant portfolio or super admin access");
  }
  if ((flags.hasExpensesAccess && !actor.hasExpensesAccess) || (flags.hasSavingsAccess && !actor.hasSavingsAccess)) {
    throw ForbiddenError("You can only grant access you have yourself");
  }
}

// Managing someone includes setting their password, so a member only manages
// people they added who still have nothing beyond what the member has. Someone
// later given more than that is out of their hands, or a member could sign in
// as an account more powerful than their own.
export function memberMayManage(
  target: Pick<
    AdminUser,
    "createdByAdminUserId" | "isOwner" | "isSuperAdmin" | "hasPortfolioAccess" | "hasExpensesAccess" | "hasSavingsAccess"
  >,
  actor: Pick<ActingAdmin, "id" | "hasExpensesAccess" | "hasSavingsAccess">,
) {
  return (
    target.createdByAdminUserId === actor.id &&
    !target.isOwner &&
    !target.isSuperAdmin &&
    !target.hasPortfolioAccess &&
    (!target.hasExpensesAccess || actor.hasExpensesAccess) &&
    (!target.hasSavingsAccess || actor.hasSavingsAccess)
  );
}

// Super admins see every account; anyone else only the people they manage.
async function findManageable(id: bigint, actor: ActingAdmin) {
  const existing = await prisma.adminUser.findUnique({
    where: { id },
    include: { _count: { select: linkedRecordCounts } },
  });
  if (!existing || (!actor.isSuperAdmin && !memberMayManage(existing, actor))) {
    throw NotFoundError("Admin user not found");
  }
  return existing;
}

// Being able to change someone's password means being able to sign in as them,
// so another super admin's account (or the owner's) is only the owner's to change.
export function assertMayChangeAccount(
  target: Pick<AdminUser, "id" | "isOwner" | "isSuperAdmin">,
  actor: Pick<ActingAdmin, "id" | "isOwner">,
) {
  if (actor.isOwner || target.id === actor.id) return;
  if (target.isOwner) throw ForbiddenError("Only the owner can edit the owner account");
  if (target.isSuperAdmin) throw ForbiddenError("Only the owner can change another super admin's account");
}

// Set on anything that should end the sessions someone already has. Written out
// rather than incremented, because older accounts may hold null here.
const nextSessionVersion = (account: Pick<AdminUser, "sessionVersion">) => (account.sessionVersion ?? 0) + 1;

// Only the owner hands out super admin, so a super admin can't promote
// others (or themselves back after a demotion).
function assertCanSetSuperAdmin(actor: ActingAdmin, value: boolean | undefined) {
  if (value !== undefined && !actor.isOwner) {
    throw ForbiddenError("Only the owner can change who is a super admin");
  }
}

// Someone belongs in the Money Hub if they have access to it, were added to it
// (a guest, or someone with an account listed on purpose), or have money
// records in it. An account that can sign in but has none of that doesn't.
export function isMoneyHubPerson(row: {
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
  listedInAdmin: boolean | null;
  passwordHash: string | null;
  linkedRecords: number;
}) {
  if (row.hasExpensesAccess || row.hasSavingsAccess || row.listedInAdmin) return true;
  if (row.linkedRecords > 0) return true;
  return row.passwordHash === null;
}

export type AccountScope = "money-hub" | "portfolio";

export async function listAdminUsers(actor: ActingAdmin, scope?: AccountScope) {
  const rows = await prisma.adminUser.findMany({
    where: actor.isSuperAdmin ? undefined : { createdByAdminUserId: actor.id },
    select: { ...rawSelectFields, createdByAdminUserId: true, _count: { select: linkedRecordCounts } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((row) => actor.isSuperAdmin || memberMayManage(row, actor))
    .filter(({ _count, ...row }) => {
      if (scope === "portfolio") return row.hasPortfolioAccess;
      return scope !== "money-hub" || isMoneyHubPerson({ ...row, linkedRecords: totalLinked(_count) });
    })
    .map(({ _count, createdByAdminUserId: _addedBy, ...row }) => ({
      ...toDto(row),
      linkedRecords: totalLinked(_count),
      // Just how much they're involved in — never what's in those records.
      activity: {
        expensesPaid: _count.expensesPaid,
        splitShares: _count.expenseSplitShares,
        groups: _count.expenseGroupMemberships,
        contributions: _count.savingsContributions,
      },
    }));
}

// Minimal, non-owner-gated listing of people who should appear in "who"
// pickers (savings account holder, expense split participants): active
// login-enabled members with at least one expense-related access flag, plus
// every guest (no login at all — they exist purely to be listed). Super admins
// get everyone; anyone else only people connected to them, and an email address
// only if it's their own or someone they added. A person with no name is shown
// by a masked address, so the picker still has something to call them.
export async function listExpenseMembers(actor: Pick<ActingAdmin, "id" | "isSuperAdmin">) {
  const rows = await prisma.adminUser.findMany({
    where: {
      isActive: true,
      OR: [
        { hasExpensesAccess: true },
        { hasSavingsAccess: true },
        { passwordHash: null },
        { listedInAdmin: true },
      ],
    },
    select: { id: true, email: true, name: true, createdByAdminUserId: true },
    orderBy: { createdAt: "asc" },
  });
  if (actor.isSuperAdmin) {
    return rows.map(({ createdByAdminUserId: _addedBy, ...row }) => row);
  }
  const connected = await connectedPeopleIds(actor.id);
  return rows
    .filter((row) => connected.has(row.id))
    .map(({ createdByAdminUserId, ...row }) => {
      if (row.id === actor.id || createdByAdminUserId === actor.id) return row;
      return { ...row, email: null, name: row.name ?? (row.email ? maskEmail(row.email) : null) };
    });
}

// Mobile numbers are unique across accounts (checked here — see schema).
export async function assertMobileFree(mobile: string, exceptId?: bigint) {
  const owner = await prisma.adminUser.findFirst({ where: { mobile } });
  if (owner && owner.id !== exceptId) {
    throw ConflictError("Another account already uses this mobile number");
  }
}

export interface CreateAdminUserInput {
  // Omit both email and password to add a guest — listed as a member but
  // unable to log in. Provide both together to create a full account.
  email?: string | null;
  mobile?: string | null;
  password?: string | null;
  // Asks for login access. If the person already has an account, a blank
  // password keeps the one they have.
  grantLogin?: boolean;
  name?: string | null;
  hasPortfolioAccess: boolean;
  hasExpensesAccess: boolean;
  hasSavingsAccess: boolean;
  isSuperAdmin?: boolean;
}

const GRANTABLE_ACCESS = ["hasPortfolioAccess", "hasExpensesAccess", "hasSavingsAccess", "isSuperAdmin"] as const;
type RequestedAccess = Partial<Record<(typeof GRANTABLE_ACCESS)[number], boolean>>;

// What adding a person who already has an account does: "grant" adds to their
// account, "list" only shows them in the Money Hub. Only super admins get this:
// anyone else could type a number and take over someone's account.
export function planExistingAccount(
  existing: Pick<
    AdminUser,
    "isActive" | "isOwner" | "isSuperAdmin" | "hasPortfolioAccess" | "hasExpensesAccess" | "hasSavingsAccess" | "passwordHash"
  >,
  grantLogin: boolean,
  actor: Pick<ActingAdmin, "isSuperAdmin">,
  requested: RequestedAccess = {},
): "grant" | "list" {
  if (!actor.isSuperAdmin) {
    throw ConflictError("This person already has an account. Ask a super admin to add them.");
  }
  if (!existing.isActive) {
    throw ConflictError("This person's account is deactivated. Edit that account and tick Active to restore it.");
  }
  if (GRANTABLE_ACCESS.some((flag) => requested[flag] && !existing[flag])) return "grant";
  const requestsAccess = GRANTABLE_ACCESS.some((flag) => requested[flag]);
  if (!grantLogin && !requestsAccess) return "list";
  const hasAdminAccess =
    existing.isOwner ||
    existing.isSuperAdmin ||
    existing.hasPortfolioAccess ||
    existing.hasExpensesAccess ||
    existing.hasSavingsAccess;
  if (hasAdminAccess && (existing.passwordHash !== null || !grantLogin)) {
    throw ConflictError("This person already has admin access. Edit their account instead.");
  }
  return "grant";
}

// Someone who already has an account (from another part of the admin) gets the
// access asked for added to it. What they already have stays, and otherwise
// they're just listed.
async function addExistingAccount(existing: AdminUser, input: CreateAdminUserInput, actor: ActingAdmin) {
  const grantLogin = Boolean(input.grantLogin || input.password);
  if (planExistingAccount(existing, grantLogin, actor, input) === "list") {
    const listed = await prisma.adminUser.update({
      where: { id: existing.id },
      data: { listedInAdmin: true, name: existing.name ?? input.name },
      select: rawSelectFields,
    });
    return { ...toDto(listed), addedToExisting: true };
  }

  assertMayChangeAccount(existing, actor);
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : existing.passwordHash;
  if (grantLogin && !passwordHash) {
    throw BadRequestError("This person has no password yet. Set one to give them access.");
  }
  const updated = await prisma.adminUser.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      sessionVersion: input.password ? nextSessionVersion(existing) : undefined,
      name: existing.name ?? input.name,
      email: existing.email ?? input.email,
      mobile: existing.mobile ?? input.mobile,
      hasPortfolioAccess: input.hasPortfolioAccess || undefined,
      hasExpensesAccess: input.hasExpensesAccess || undefined,
      hasSavingsAccess: input.hasSavingsAccess || undefined,
      isSuperAdmin: input.isSuperAdmin || undefined,
    },
    select: rawSelectFields,
  });
  return { ...toDto(updated), addedToExisting: true };
}

export async function createAdminUser(input: CreateAdminUserInput, actor: ActingAdmin) {
  assertMemberGrant(actor, input);
  assertCanSetSuperAdmin(actor, input.isSuperAdmin ? true : undefined);

  const byMobile = input.mobile ? await prisma.adminUser.findFirst({ where: { mobile: input.mobile } }) : null;
  const byEmail = input.email ? await prisma.adminUser.findUnique({ where: { email: input.email } }) : null;
  if (byMobile && byEmail && byMobile.id !== byEmail.id) {
    throw ConflictError("This email and this mobile number belong to two different accounts");
  }
  const existingAccount = byMobile ?? byEmail;
  if (existingAccount) return addExistingAccount(existingAccount, input, actor);

  if (input.password && !input.email && !input.mobile) {
    throw BadRequestError("Login access needs an email or a mobile number along with the password");
  }
  if (input.grantLogin && !input.password) {
    throw BadRequestError("Set a password to give this person login access");
  }
  if (input.email && !input.password) {
    throw BadRequestError("Provide a password with the email to grant login access, or leave both out for a guest member");
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const created = await prisma.adminUser.create({
    data: {
      email: input.email || null,
      mobile: input.mobile || null,
      passwordHash,
      name: input.name,
      hasPortfolioAccess: input.hasPortfolioAccess,
      hasExpensesAccess: input.hasExpensesAccess,
      hasSavingsAccess: input.hasSavingsAccess,
      isSuperAdmin: input.isSuperAdmin ?? false,
      createdByAdminUserId: actor.id,
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
  mobile?: string | null;
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
  const existing = await findManageable(id, actor);
  assertMemberGrant(actor, input);
  assertMayChangeAccount(existing, actor);
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
  const nextMobile = input.mobile === undefined ? existing.mobile : input.mobile;
  const nextHasPassword = !input.removeLogin && (input.password !== undefined || existing.passwordHash !== null);
  if (nextHasPassword && !nextEmail && !nextMobile) {
    throw BadRequestError("An email or a mobile number is required to grant login access");
  }
  if (input.mobile) await assertMobileFree(input.mobile, id);
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
      mobile: input.mobile,
      passwordHash,
      // Old sessions mustn't come back to life if they're reactivated later.
      sessionVersion:
        input.password || input.removeLogin || input.isActive === false ? nextSessionVersion(existing) : undefined,
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

// Stops a double click, or a member repeatedly mailing someone they added.
export const WELCOME_COOLDOWN_SECONDS = 60;

// Why this account can't be sent a welcome email, if there's a reason. It tells
// them how to sign in, so it's only for someone who can.
export function welcomeEmailBlocker(
  account: Pick<AdminUser, "isActive" | "email" | "passwordHash" | "welcomeEmailSentAt">,
  now = Date.now(),
) {
  if (!account.isActive) return "This account is deactivated. Reactivate it before sending a welcome email.";
  if (!account.email) return "This person has no email address. Add one to send them a welcome email.";
  if (!account.passwordHash) return "This person can't sign in yet. Give them login access before sending a welcome email.";
  const waitSeconds = account.welcomeEmailSentAt
    ? Math.ceil(WELCOME_COOLDOWN_SECONDS - (now - account.welcomeEmailSentAt.getTime()) / 1000)
    : 0;
  if (waitSeconds > 0) return `A welcome email was just sent. You can send another in ${waitSeconds} seconds.`;
  return null;
}

export async function sendWelcomeEmail(id: bigint, actor: ActingAdmin) {
  const account = await findManageable(id, actor);
  const blocker = welcomeEmailBlocker(account);
  if (blocker) throw BadRequestError(blocker);
  if (!isEmailEnabled()) {
    throw new HttpError(503, "Email isn't set up on the server yet, so this can't be sent.", "EMAIL_OFF");
  }

  try {
    await sendEmail(buildWelcomeEmail({ ...account, email: account.email! }, env.adminSignInUrl));
  } catch (error) {
    const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
    console.error("Couldn't send a welcome email:", reason);
    throw new HttpError(502, "We couldn't send the email just now. Please try again shortly.", "EMAIL_FAILED");
  }

  const updated = await prisma.adminUser.update({
    where: { id },
    data: { welcomeEmailSentAt: new Date() },
    select: rawSelectFields,
  });
  return toDto(updated);
}

export async function deleteAdminUser(id: bigint, actor: ActingAdmin, permanent = false) {
  const existing = await findManageable(id, actor);
  if (existing.isOwner) {
    throw BadRequestError("The owner account can't be deactivated or deleted");
  }
  assertMayChangeAccount(existing, actor);
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
  await prisma.adminUser.update({
    where: { id },
    data: { isActive: false, sessionVersion: nextSessionVersion(existing) },
  });
}
