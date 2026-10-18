import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";
import { calculateTotalExperienceYears } from "../experience/experience.utils";
import { deleteUploadedFile } from "../../middleware/upload";

// Ported from main/models.py UserProfile.formatted_experience() /
// formatted_experience_in_years().
function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

// Completed months only (floored, not rounded) — rounding reported a month
// early (e.g. "5 years 8 months" for 5y 7m 17d) and could even produce
// "12 months", and it disagreed with the per-role durations on the About page.
export function formatExperience(totalExperience: string | number) {
  const totalMonths = Math.floor(Number(totalExperience) * 12 + 1e-9);
  return `${plural(Math.floor(totalMonths / 12), "year")} ${plural(totalMonths % 12, "month")}`;
}

export function formatExperienceInYears(totalExperience: string | number) {
  return Math.floor(Number(totalExperience));
}

// Computes experience live from the current experience_details rows rather than
// trusting the stored total_experience column, so an ongoing role's duration
// keeps advancing on every read instead of only updating when an admin edits it.
async function withComputed<T extends { id: bigint }>(profile: T) {
  const totalExperience = await calculateTotalExperienceYears(profile.id);
  return {
    ...profile,
    totalExperience: totalExperience.toFixed(2),
    formattedExperience: formatExperience(totalExperience),
    formattedExperienceInYears: formatExperienceInYears(totalExperience),
  };
}

// Single-tenant site: there is only ever one UserProfile row.
export async function getProfile() {
  const profile = await prisma.userProfile.findFirst();
  if (!profile) {
    throw NotFoundError("Profile not found");
  }
  return withComputed(profile);
}

// Every other resource (experience, education, projects, ...) FKs to the one
// site-owner profile. Admin write endpoints for those resources use this
// instead of requiring the caller to pass a userProfileId.
export async function getProfileId(): Promise<bigint> {
  const profile = await prisma.userProfile.findFirst({ select: { id: true } });
  if (!profile) {
    throw NotFoundError("Profile not found");
  }
  return profile.id;
}

export interface UpdateProfileInput {
  fullName?: string;
  email?: string;
  bio?: string | null;
  objective?: string | null;
  contactNumber?: string | null;
  address?: string | null;
  facebookId?: string | null;
  instaId?: string | null;
  linkedinId?: string | null;
  twitterId?: string | null;
  profilePicture?: string;
  signature?: string | null;
}

export async function updateProfile(data: UpdateProfileInput) {
  const existing = await prisma.userProfile.findFirst();
  if (!existing) {
    throw NotFoundError("Profile not found");
  }
  const updated = await prisma.userProfile.update({
    where: { id: existing.id },
    data,
  });
  // Drop the stored images this update just replaced or removed.
  if (data.profilePicture !== undefined && data.profilePicture !== existing.profilePicture) {
    await deleteUploadedFile(existing.profilePicture);
  }
  if (data.signature !== undefined && data.signature !== existing.signature) {
    await deleteUploadedFile(existing.signature);
  }
  return withComputed(updated);
}
