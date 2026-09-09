import { prisma } from "../../lib/prisma";

// Ported from main/models.py ExperienceDetails.get_duration(): duration in years
// (as a float), treating a null end_date as "ongoing" (up to today) — so an
// in-progress role's duration grows on its own as time passes, not just when
// an admin edits the record.
function durationInYears(startDate: Date, endDate: Date | null): number {
  const end = endDate ?? new Date();
  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  return Math.max(0, (end.getTime() - startDate.getTime()) / msPerYear);
}

// Live total: sums duration across all of a profile's experience rows, evaluated
// against the current date. Used both to persist UserProfile.totalExperience on
// writes (recomputeTotalExperience) and to serve an always-current value on
// reads (profile.service.ts's getProfile), so an ongoing role's displayed
// experience keeps advancing even between admin edits.
export async function calculateTotalExperienceYears(userProfileId: bigint): Promise<number> {
  const rows = await prisma.experienceDetails.findMany({
    where: { userProfileId },
    select: { startDate: true, endDate: true },
  });

  return rows.reduce((sum, row) => sum + durationInYears(row.startDate, row.endDate), 0);
}
