import { prisma } from "../src/lib/prisma";

import { GENERAL_CATEGORIES } from "./general-categories";

// Seeds the general (shared) expense categories, with their icons. Safe to
// re-run: names that already exist (compared case-insensitively) are
// skipped, so categories added or renamed by hand stay.
//   npm run seed:categories
async function main() {
  const existing = await prisma.expenseCategory.findMany({
    // Shared ones only (no owner; older rows have no owner field at all).
    where: { OR: [{ ownerAdminUserId: null }, { ownerAdminUserId: { isSet: false } }] },
    select: { name: true } });
  const taken = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const toAdd = GENERAL_CATEGORIES.filter(({ name }) => !taken.has(name.toLowerCase()));

  if (toAdd.length > 0) {
    await prisma.expenseCategory.createMany({
      data: toAdd.map(({ name, icon }) => ({ name, iconType: "icon", icon })),
    });
  }
  console.log(`Added ${toAdd.length} categories; ${GENERAL_CATEGORIES.length - toAdd.length} already existed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
