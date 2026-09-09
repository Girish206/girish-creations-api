import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";
import { calculateTotalExperienceYears } from "./experience.utils";

// Ported from ExperienceDetails.save(): every write recomputes and persists
// UserProfile.total_experience as the sum of durations across all of that
// profile's experience rows. Called explicitly after each create/update/delete
// rather than as a DB trigger, so it stays visible and testable here. This
// stored value is a convenience snapshot (e.g. for admin listing) — the public
// profile read always recomputes live instead of trusting it, since an ongoing
// role's duration should keep advancing without needing an edit to "refresh" it.
export async function recomputeTotalExperience(userProfileId: bigint) {
  const totalYears = await calculateTotalExperienceYears(userProfileId);

  await prisma.userProfile.update({
    where: { id: userProfileId },
    data: { totalExperience: totalYears.toFixed(2) },
  });
}

export async function listExperience() {
  return prisma.experienceDetails.findMany({ orderBy: { startDate: "desc" } });
}

export interface ExperienceInput {
  jobTitle: string;
  companyName: string;
  location?: string | null;
  startDate: string;
  endDate?: string | null;
  description?: string | null;
  userProfileId: bigint;
}

export async function createExperience(input: ExperienceInput) {
  const created = await prisma.experienceDetails.create({
    data: {
      jobTitle: input.jobTitle,
      companyName: input.companyName,
      location: input.location,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      description: input.description,
      userProfileId: input.userProfileId,
    },
  });
  await recomputeTotalExperience(input.userProfileId);
  return created;
}

export async function updateExperience(id: bigint, input: Partial<ExperienceInput>) {
  const existing = await prisma.experienceDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Experience entry not found");
  }

  const updated = await prisma.experienceDetails.update({
    where: { id },
    data: {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
    },
  });
  await recomputeTotalExperience(existing.userProfileId);
  return updated;
}

export async function deleteExperience(id: bigint) {
  const existing = await prisma.experienceDetails.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Experience entry not found");
  }
  await prisma.experienceDetails.delete({ where: { id } });
  await recomputeTotalExperience(existing.userProfileId);
}
