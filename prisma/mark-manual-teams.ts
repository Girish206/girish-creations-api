// One-off fix for tournament teams built by hand before the `manual` flag
// was stored. Those teams came back unflagged, so the Teams tab showed them
// as "Auto" and generating would have refilled them from the matched sets.
//
// A tournament that has never generated (generatedAt null) has no generated
// teams, so each of its teams that has players gets manual: true (blank ones
// are left: they're the slots the team builder generates into). In a
// tournament that has generated, a hand-built team can't be told apart, so
// those are only listed to check by hand. Prints what it would do unless
// run with --apply.
//
//   npm run migrate:mark-manual-teams             (dry run)
//   npm run migrate:mark-manual-teams -- --apply
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

async function main() {
  const tournaments = await prisma.cricketTournament.findMany();
  let marked = 0;
  for (const tournament of tournaments) {
    const unflagged = tournament.teams.filter((team) => !team.manual && team.playerIds.length > 0);
    if (unflagged.length === 0) continue;
    const names = unflagged.map((team) => team.name).join(", ");
    if (tournament.generatedAt) {
      console.log(`check by hand  #${tournament.id} ${tournament.name}: has generated, unflagged teams ${names}`);
      continue;
    }
    console.log(`${apply ? "marked" : "would mark"}  #${tournament.id} ${tournament.name}: ${names}`);
    marked += unflagged.length;
    if (apply) {
      await prisma.cricketTournament.update({
        where: { id: tournament.id },
        data: {
          teams: tournament.teams.map((team) => (!team.manual && team.playerIds.length > 0 ? { ...team, manual: true } : team)),
        },
      });
    }
  }
  console.log(`${apply ? "Marked" : "Would mark"} ${marked} team(s).${apply ? "" : " Run with --apply to save."}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
