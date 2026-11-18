// Gives every shared fund made before funds had trip groups its group, and
// moves the expenses paid from it (that aren't in a group yet) into it, so
// they settle up together with the trip. Safe to run again.
//   npm run migrate:link-fund-groups
import { prisma } from "../src/lib/prisma";
import { syncFundGroup } from "../src/modules/savings-goal/savings-goal.service";
import { FUND_KIND } from "../src/modules/savings-goal/fund-split";

async function main() {
  const funds = await prisma.savingsGoal.findMany({
    where: { kind: FUND_KIND },
    select: { id: true, name: true, createdByAdminUserId: true, accountHolderAdminUserId: true },
  });
  for (const fund of funds) {
    const actor = fund.createdByAdminUserId ?? fund.accountHolderAdminUserId;
    if (actor === null) {
      console.log(`Skipped ${fund.name}: nobody made or keeps it`);
      continue;
    }
    const groupId = await syncFundGroup(fund.id, actor);
    if (groupId === null) continue;
    const moved = await prisma.expense.updateMany({
      where: { savingsGoalId: fund.id, expenseGroupId: null },
      data: { expenseGroupId: groupId },
    });
    console.log(`${fund.name}: trip group ${groupId}, moved ${moved.count} expense(s) into it`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
