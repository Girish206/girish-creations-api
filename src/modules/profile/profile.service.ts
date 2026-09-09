import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../utils/httpError";
import type { Prisma } from "@prisma/client";
import { calculateTotalExperienceYears } from "../experience/experience.utils";

// Ported from main/models.py UserProfile.formatted_experience() /
// formatted_experience_in_years().
export function formatExperience(totalExperience: Prisma.Decimal | number) {
  const years = Number(totalExperience);
  const wholeYears = Math.floor(years);
  const months = Math.round((years - wholeYears) * 12);
  return `${wholeYears} years ${months} months`;
}

export function formatExperienceInYears(totalExperience: Prisma.Decimal | number) {
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
  return withComputed(updated);
}
