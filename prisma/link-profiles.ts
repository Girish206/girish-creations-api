// One-off migration to multi-portfolio support: the site used to have a
// single UserProfile with no owner. This links it to the owner admin account,
// gives it a username (its public URL becomes /<username>), points it at the
// résumé the client used to hard-code, and attaches contact messages sent
// before messages were tied to a portfolio. Safe to re-run.
//
//   npm run migrate:link-profiles
import { prisma } from "../src/lib/prisma";
import { uniqueUsername } from "../src/modules/profile/profile.service";

// The résumé bundled with the client (public/assets/resume) that every page
// linked to before each portfolio could upload its own.
const LEGACY_RESUME = "/assets/resume/Girish S Resume.pdf";

async function main() {
  const owner = await prisma.adminUser.findFirst({ where: { isOwner: true }, orderBy: { id: "asc" } });
  if (!owner) {
    throw new Error("No owner admin account found — run the seed first");
  }

  const unlinked = await prisma.userProfile.findMany({
    where: { OR: [{ adminUserId: { isSet: false } }, { adminUserId: null }] },
    orderBy: { id: "asc" },
  });
  const ownerProfile = await prisma.userProfile.findUnique({ where: { adminUserId: owner.id } });

  let linked = ownerProfile;
  if (!ownerProfile && unlinked.length > 0) {
    const legacy = unlinked[0];
    linked = await prisma.userProfile.update({
      where: { id: legacy.id },
      data: {
        adminUserId: owner.id,
        username: legacy.username ?? (await uniqueUsername(legacy.fullName)),
        resume: legacy.resume ?? LEGACY_RESUME,
      },
    });
    console.log(`Linked profile "${linked.fullName}" to ${owner.email} as /${linked.username}`);
  } else if (ownerProfile) {
    console.log(`Owner already has a portfolio: /${ownerProfile.username}`);
  }

  const leftover = unlinked.filter((profile) => profile.id !== linked?.id);
  for (const profile of leftover) {
    console.warn(`Profile ${profile.id} ("${profile.fullName}") has no account — link it manually`);
  }

  if (linked) {
    const { count } = await prisma.contactMessage.updateMany({
      where: { OR: [{ userProfileId: { isSet: false } }, { userProfileId: null }] },
      data: { userProfileId: linked.id },
    });
    if (count > 0) {
      console.log(`Attached ${count} older contact message(s) to /${linked.username}`);
    }
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
