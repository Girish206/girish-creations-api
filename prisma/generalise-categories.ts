import { prisma } from "../src/lib/prisma";
import { GENERAL_CATEGORIES } from "./general-categories";

// One-off: folds the old, detailed shared categories into the broad general
// set in general-categories.ts. For each general category it keeps one row
// (one already named that, else the busiest of its old categories), renames
// it and sets its icon, then moves every other old category's expenses into
// it and removes them. Custom (member-owned) categories are never touched.
//
// Dry run by default — prints the plan and changes nothing:
//   npm run migrate:generalise-categories
// Then apply it:
//   npm run migrate:generalise-categories -- --apply

const apply = process.argv.includes("--apply");
const key = (name: string) => name.trim().toLowerCase();

async function main() {
  const shared = await prisma.expenseCategory.findMany({
    where: { OR: [{ ownerAdminUserId: null }, { ownerAdminUserId: { isSet: false } }] },
    include: { _count: { select: { expenses: true } } },
  });
  const byName = new Map(shared.map((category) => [key(category.name), category]));
  const claimed = new Set<bigint>();

  for (const general of GENERAL_CATEGORIES) {
    const sources = [general.name, ...general.from]
      .map((name) => byName.get(key(name)))
      .filter((category): category is (typeof shared)[number] => Boolean(category) && !claimed.has(category!.id));
    const keeper =
      byName.get(key(general.name)) ?? [...sources].sort((a, b) => b._count.expenses - a._count.expenses)[0];
    const others = sources.filter((category) => category.id !== keeper?.id);

    if (!keeper) {
      console.log(`+ create  ${general.name}`);
      if (apply) await prisma.expenseCategory.create({ data: { name: general.name, iconType: "icon", icon: general.icon } });
      continue;
    }
    claimed.add(keeper.id);
    const rename = keeper.name === general.name ? "" : `  (renamed from "${keeper.name}")`;
    console.log(`= keep    ${general.name} #${keeper.id}${rename}, ${keeper._count.expenses} expenses`);
    if (apply) {
      await prisma.expenseCategory.update({
        where: { id: keeper.id },
        data: { name: general.name, iconType: "icon", icon: general.icon },
      });
    }
    for (const other of others) {
      claimed.add(other.id);
      console.log(`    merge ${other.name} #${other.id} → ${general.name}  (${other._count.expenses} expenses)`);
      if (apply) {
        await prisma.expense.updateMany({ where: { categoryId: other.id }, data: { categoryId: keeper.id } });
        await prisma.expenseCategory.delete({ where: { id: other.id } });
      }
    }
  }

  const leftover = shared.filter((category) => !claimed.has(category.id));
  for (const category of leftover) {
    console.log(`! left alone (not in the general set): ${category.name} #${category.id}, ${category._count.expenses} expenses`);
  }
  console.log(apply ? "Applied." : "Dry run — nothing changed. Re-run with --apply to make these changes.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
