// One-off fix for accounts that ended up with several portfolios. Before
// getOrCreateOwnProfile guarded against it, the admin panel's parallel
// first-load requests could each create a profile for a new account, so the
// people directory listed that person several times.
//
// For each account with more than one profile, keeps the one with the most
// content (ties go to the oldest), moves any rows the others own onto it and
// deletes the others. Prints what it would do unless run with --apply.
//
//   npm run migrate:dedupe-profiles             (dry run)
//   npm run migrate:dedupe-profiles -- --apply
//
// Afterwards run `npx prisma db push` so the unique indexes on
// user_profiles.admin_user_id and .username exist and this can't recur.
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

// Every model that hangs off a UserProfile.
const childModels = [
  prisma.experienceDetails,
  prisma.educationDetails,
  prisma.certificationDetails,
  prisma.skill,
  prisma.tool,
  prisma.contactMessage,
  prisma.blogPost,
  prisma.projectDetails,
] as unknown as {
  count(args: { where: { userProfileId: bigint } }): Promise<number>;
  updateMany(args: { where: { userProfileId: bigint }; data: { userProfileId: bigint } }): Promise<{ count: number }>;
}[];

const profileFields = [
  "bio",
  "objective",
  "profilePicture",
  "signature",
  "contactNumber",
  "address",
  "facebookId",
  "instaId",
  "linkedinId",
  "twitterId",
  "resume",
] as const;

async function contentScore(profile: Awaited<ReturnType<typeof prisma.userProfile.findMany>>[number]) {
  const rows = await Promise.all(childModels.map((model) => model.count({ where: { userProfileId: profile.id } })));
  const fields = profileFields.filter((field) => profile[field]).length;
  return rows.reduce((sum, n) => sum + n, 0) * 10 + fields;
}

async function main() {
  const profiles = await prisma.userProfile.findMany({ orderBy: { id: "asc" } });
  const byAccount = new Map<bigint, typeof profiles>();
  for (const profile of profiles) {
    if (profile.adminUserId === null) continue;
    byAccount.set(profile.adminUserId, [...(byAccount.get(profile.adminUserId) ?? []), profile]);
  }

  let removed = 0;
  for (const [adminUserId, group] of byAccount) {
    if (group.length < 2) continue;

    const scored = await Promise.all(group.map(async (profile) => ({ profile, score: await contentScore(profile) })));
    // Highest score first; the sort is stable, so ties keep the oldest.
    scored.sort((a, b) => b.score - a.score);
    const [keep, ...drop] = scored.map((entry) => entry.profile);

    console.log(
      `Account ${adminUserId}: keeping profile ${keep.id} (/${keep.username}), removing ${drop.map((p) => p.id).join(", ")}`,
    );
    for (const profile of drop) {
      for (const model of childModels) {
        const where = { userProfileId: profile.id };
        const moving = await model.count({ where });
        if (moving === 0) continue;
        console.log(`  moving ${moving} row(s) from profile ${profile.id} to ${keep.id}`);
        if (apply) await model.updateMany({ where, data: { userProfileId: keep.id } });
      }
      if (apply) await prisma.userProfile.delete({ where: { id: profile.id } });
      removed += 1;
    }
  }

  if (removed === 0) {
    console.log("No duplicate portfolios found.");
  } else if (!apply) {
    console.log(`\nDry run: ${removed} duplicate profile(s) would be removed. Re-run with --apply to do it.`);
  } else {
    console.log(`\nRemoved ${removed} duplicate profile(s). Now run: npx prisma db push`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
