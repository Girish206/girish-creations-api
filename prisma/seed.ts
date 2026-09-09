import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";

async function main() {
  if (!env.adminSeedEmail || !env.adminSeedPassword) {
    throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD must be set to seed an admin user");
  }

  const passwordHash = await bcrypt.hash(env.adminSeedPassword, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email: env.adminSeedEmail },
    update: {
      passwordHash,
      isOwner: true,
      hasPortfolioAccess: true,
      hasExpensesAccess: true,
      hasInvestmentsAccess: true,
      hasSavingsAccess: true,
    },
    create: {
      email: env.adminSeedEmail,
      passwordHash,
      isOwner: true,
      hasPortfolioAccess: true,
      hasExpensesAccess: true,
      hasInvestmentsAccess: true,
      hasSavingsAccess: true,
    },
  });

  console.log(`Seeded admin user: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
