import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { deleteUploadedFile } from "../../middleware/upload";

export interface ExpenseCategoryInput {
  name: string;
  iconType?: string;
  icon?: string | null;
}

export interface RequestingAdmin {
  id: bigint;
  isSuperAdmin: boolean;
}

// Two kinds of category:
//  - shared (ownerAdminUserId null): everyone sees and picks them; only a
//    super admin adds, changes, merges or removes them.
//  - custom (ownerAdminUserId set): what a member adds is theirs alone —
//    only they see, pick, change, merge or remove it.

// Shared categories. On MongoDB `null` only matches a stored null, and
// categories saved before ownership existed have no owner field at all, so
// "unset" counts as shared too.
export const SHARED_CATEGORY = { OR: [{ ownerAdminUserId: null }, { ownerAdminUserId: { isSet: false } }] };

// What someone can see and pick: the shared list plus their own custom ones.
function visibleTo(admin: RequestingAdmin) {
  return { OR: [...SHARED_CATEGORY.OR, { ownerAdminUserId: admin.id }] };
}

// "Food" and "food " are the same category to people picking one, so names
// are matched ignoring case and spacing.
function sameName(name: string) {
  return { name: { equals: name.trim(), mode: "insensitive" as const } };
}

// A custom category may not repeat a shared name or one of the member's own;
// a shared one may not repeat another shared name.
async function assertNameFree(name: string, ownerAdminUserId: bigint | null, exceptId?: bigint) {
  const scope =
    ownerAdminUserId === null ? SHARED_CATEGORY : { OR: [...SHARED_CATEGORY.OR, { ownerAdminUserId }] };
  const clash = await prisma.expenseCategory.findFirst({
    where: { AND: [sameName(name), scope, ...(exceptId !== undefined ? [{ id: { not: exceptId } }] : [])] },
  });
  if (clash) {
    throw ConflictError(`"${clash.name}" already exists — use that one`);
  }
}

// Loads a category the requester may change: a shared one needs a super
// admin, a custom one its owner.
async function loadForChange(id: bigint, admin: RequestingAdmin) {
  const category = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!category || (category.ownerAdminUserId !== null && category.ownerAdminUserId !== admin.id)) {
    throw NotFoundError("Category not found");
  }
  if (category.ownerAdminUserId === null && !admin.isSuperAdmin) {
    throw ForbiddenError("Only a super admin can change shared categories");
  }
  return category;
}

export async function listExpenseCategories(admin: RequestingAdmin) {
  return prisma.expenseCategory.findMany({ where: visibleTo(admin), orderBy: { name: "asc" } });
}

// A super admin adds to the shared list; anyone else adds a custom category
// of their own.
export async function createExpenseCategory(input: ExpenseCategoryInput, admin: RequestingAdmin) {
  const ownerAdminUserId = admin.isSuperAdmin ? null : admin.id;
  await assertNameFree(input.name, ownerAdminUserId);
  return prisma.expenseCategory.create({ data: { ...input, ownerAdminUserId } });
}

export async function updateExpenseCategory(id: bigint, input: ExpenseCategoryInput, admin: RequestingAdmin) {
  const existing = await loadForChange(id, admin);
  await assertNameFree(input.name, existing.ownerAdminUserId, id);
  const updated = await prisma.expenseCategory.update({ where: { id }, data: input });
  // Drop the old uploaded image once it's been replaced or switched away from.
  if (input.iconType !== undefined && existing.icon !== updated.icon) {
    await deleteUploadedFile(existing.icon);
  }
  return updated;
}

export async function deleteExpenseCategory(id: bigint, admin: RequestingAdmin) {
  const existing = await loadForChange(id, admin);
  // Counted across everyone's expenses, not just the requester's visible ones.
  const expenses = await prisma.expense.count({ where: { categoryId: id } });
  if (expenses > 0) {
    throw ConflictError(
      `${expenses} expense${expenses === 1 ? " uses" : "s use"} this category — move ${expenses === 1 ? "it" : "them"} to another category first`,
    );
  }
  await prisma.expenseCategory.delete({ where: { id } });
  await deleteUploadedFile(existing.icon);
}

// Folds a duplicate into the category to keep: its expenses move across and
// it's removed. A custom category can go into a shared one or another of the
// member's own; a shared one only into another shared one (its expenses
// belong to everyone). Returns how many expenses moved.
export async function mergeExpenseCategory(id: bigint, intoId: bigint, admin: RequestingAdmin) {
  if (id === intoId) {
    throw BadRequestError("Pick a different category to merge into");
  }
  const source = await loadForChange(id, admin);
  const target = await prisma.expenseCategory.findFirst({ where: { id: intoId, ...visibleTo(admin) } });
  if (!target) {
    throw NotFoundError("Category not found");
  }
  if (source.ownerAdminUserId === null && target.ownerAdminUserId !== null) {
    throw BadRequestError("A shared category can only be merged into another shared category");
  }
  const { count } = await prisma.expense.updateMany({ where: { categoryId: id }, data: { categoryId: intoId } });
  await prisma.expenseCategory.delete({ where: { id } });
  await deleteUploadedFile(source.icon);
  return { moved: count, into: target };
}

// For expenses: a category someone may pick — shared, or their own custom
// one. A super admin may pick any (they edit everyone's expenses).
export async function assertCategoryUsable(categoryId: bigint, admin: RequestingAdmin) {
  const found = await prisma.expenseCategory.count({
    where: admin.isSuperAdmin ? { id: categoryId } : { id: categoryId, ...visibleTo(admin) },
  });
  if (found === 0) {
    throw BadRequestError("That category no longer exists");
  }
}
