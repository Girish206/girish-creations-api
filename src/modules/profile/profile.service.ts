import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";
import { calculateTotalExperienceYears } from "../experience/experience.utils";
import { deleteUploadedFile } from "../../middleware/upload";
import { slugify } from "../../utils/slugify";

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
//
// Also adds what the public site needs to decide what to show:
//  - isCreator: the portfolio belongs to the owner account, the person who
//    built the site. Freelance/hire-me content only appears on theirs.
//  - counts: how many of each section's rows exist, so pages and nav links
//    with nothing in them can be hidden instead of showing filler.
async function withComputed<T extends { id: bigint; adminUserId: bigint | null }>(profile: T) {
  const where = { userProfileId: profile.id };
  const [totalExperience, owner, experience, education, certifications, skills, tools, projects, blogPosts] =
    await Promise.all([
      calculateTotalExperienceYears(profile.id),
      profile.adminUserId === null
        ? null
        : prisma.adminUser.findUnique({ where: { id: profile.adminUserId }, select: { isOwner: true } }),
      prisma.experienceDetails.count({ where }),
      prisma.educationDetails.count({ where }),
      prisma.certificationDetails.count({ where }),
      prisma.skill.count({ where }),
      prisma.tool.count({ where }),
      prisma.projectDetails.count({ where }),
      prisma.blogPost.count({ where }),
    ]);
  return {
    ...profile,
    totalExperience: totalExperience.toFixed(2),
    formattedExperience: formatExperience(totalExperience),
    formattedExperienceInYears: formatExperienceInYears(totalExperience),
    isCreator: owner?.isOwner ?? false,
    counts: { experience, education, certifications, skills, tools, projects, blogPosts },
  };
}

// A portfolio is publicly visible while its account is active and still has
// portfolio access (the original, pre-multi-portfolio profile shows up once
// prisma/link-profiles.ts has linked it to an account).
const visibleWhere = {
  adminUser: { is: { isActive: true, hasPortfolioAccess: true } },
};

// Public directory of every visible portfolio, for the site's home page.
export async function listPortfolios() {
  const rows = await prisma.userProfile.findMany({
    where: visibleWhere,
    select: {
      id: true,
      username: true,
      fullName: true,
      profilePicture: true,
      bio: true,
      adminUser: { select: { isOwner: true } },
    },
    orderBy: { id: "asc" },
  });
  return Promise.all(
    rows.map(async ({ adminUser, ...row }) => {
      const [headline, projectCount, totalExperience] = await Promise.all([
        prisma.experienceDetails.findFirst({
          where: { userProfileId: row.id },
          orderBy: [{ startDate: "desc" }],
          select: { jobTitle: true, companyName: true, endDate: true },
        }),
        prisma.projectDetails.count({ where: { userProfileId: row.id } }),
        calculateTotalExperienceYears(row.id),
      ]);
      return {
        ...row,
        // The person who built the site; the directory credits them.
        isCreator: adminUser?.isOwner ?? false,
        jobTitle: headline?.jobTitle ?? null,
        companyName: headline && !headline.endDate ? headline.companyName : null,
        projectCount,
        formattedExperience: formatExperience(totalExperience),
        formattedExperienceInYears: formatExperienceInYears(totalExperience),
      };
    }),
  );
}

// Accounts a super admin can switch the admin portfolio pages to: every
// login with portfolio access, with their portfolio's name and handle if
// they have opened it yet.
export async function listManageablePortfolios() {
  const accounts = await prisma.adminUser.findMany({
    where: { hasPortfolioAccess: true, passwordHash: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      portfolioProfile: { select: { fullName: true, username: true, profilePicture: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map(({ portfolioProfile, ...account }) => ({
    ...account,
    fullName: portfolioProfile?.fullName ?? null,
    username: portfolioProfile?.username ?? null,
    profilePicture: portfolioProfile?.profilePicture ?? null,
  }));
}

// Resolves the /<username> of a public portfolio URL to its profile id.
export async function getVisibleProfileId(username: string): Promise<bigint> {
  const profile = await prisma.userProfile.findFirst({
    where: { ...visibleWhere, username: username.toLowerCase() },
    select: { id: true },
  });
  if (!profile) {
    throw NotFoundError("Portfolio not found");
  }
  return profile.id;
}

export async function getProfile(id: bigint) {
  const profile = await prisma.userProfile.findUnique({ where: { id } });
  if (!profile) {
    throw NotFoundError("Profile not found");
  }
  return withComputed(profile);
}

// Top-level client routes and API/static prefixes a username would shadow,
// since portfolios live at /<username> — plus the page names that used to be
// top-level (/about, /blog, ...) before multi-portfolio support, so old links
// can never land on someone else's portfolio.
const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "assets",
  "logo",
  "login",
  "logout",
  "static",
  "uploads",
  "about",
  "experience",
  "skills",
  "projects",
  "services",
  "contact",
  "blog",
]);
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

async function usernameTaken(username: string, excludeId?: bigint) {
  const existing = await prisma.userProfile.findUnique({ where: { username }, select: { id: true } });
  return existing !== null && existing.id !== excludeId;
}

export async function uniqueUsername(base: string) {
  const root = slugify(base).slice(0, 34).replace(/-+$/, "");
  const start = USERNAME_PATTERN.test(root) && !RESERVED_USERNAMES.has(root) ? root : `${root || "user"}-profile`;
  let candidate = start;
  let suffix = 2;
  while (await usernameTaken(candidate)) {
    candidate = `${start}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// Profile creations in progress, by admin account id. The admin panel loads
// several portfolio endpoints at once on a first visit, and each one runs
// resolveOwnPortfolio — without this they would all see "no profile yet"
// and each create one, leaving the account with duplicate portfolios.
const pendingCreates = new Map<bigint, Promise<Awaited<ReturnType<typeof createOwnProfile>>>>();

async function createOwnProfile(adminUserId: bigint) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) {
    throw NotFoundError("Admin user not found");
  }
  const fullName = admin.name?.trim() || admin.email?.split("@")[0] || "New member";
  try {
    return await prisma.userProfile.create({
      data: {
        fullName,
        email: admin.email ?? "",
        username: await uniqueUsername(fullName),
        adminUserId,
      },
    });
  } catch (err) {
    // Another server instance won the race: the unique index on
    // admin_user_id rejected this one, so use the profile it created.
    const created = await prisma.userProfile.findUnique({ where: { adminUserId } });
    if (created) {
      return created;
    }
    throw err;
  }
}

// The portfolio an admin account edits. Created on first use, so granting
// someone portfolio access is all it takes to give them their own page.
export async function getOrCreateOwnProfile(adminUserId: bigint) {
  const existing = await prisma.userProfile.findUnique({ where: { adminUserId } });
  if (existing) {
    return existing;
  }

  let pending = pendingCreates.get(adminUserId);
  if (!pending) {
    pending = createOwnProfile(adminUserId).finally(() => pendingCreates.delete(adminUserId));
    pendingCreates.set(adminUserId, pending);
  }
  return pending;
}

export const PORTFOLIO_STYLES = ["tech", "classic"] as const;
export type PortfolioStyle = (typeof PORTFOLIO_STYLES)[number];

export const PORTFOLIO_ACCENTS = ["emerald", "ocean", "indigo", "rose", "sunset", "violet"] as const;
export type PortfolioAccent = (typeof PORTFOLIO_ACCENTS)[number];

export interface UpdateProfileInput {
  username?: string;
  fullName?: string;
  email?: string;
  bio?: string | null;
  objective?: string | null;
  contactNumber?: string | null;
  showContactNumber?: boolean;
  address?: string | null;
  facebookId?: string | null;
  instaId?: string | null;
  linkedinId?: string | null;
  twitterId?: string | null;
  profilePicture?: string;
  signature?: string | null;
  resume?: string | null;
  portfolioStyle?: PortfolioStyle;
  portfolioAccent?: PortfolioAccent;
}

export async function updateProfile(id: bigint, data: UpdateProfileInput) {
  const existing = await prisma.userProfile.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Profile not found");
  }

  if (data.username !== undefined) {
    data.username = data.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(data.username)) {
      throw BadRequestError(
        "Username must be 3–40 characters: lowercase letters, numbers and hyphens, starting and ending with a letter or number",
      );
    }
    if (RESERVED_USERNAMES.has(data.username)) {
      throw BadRequestError("That username is reserved");
    }
    if (await usernameTaken(data.username, id)) {
      throw ConflictError("That username is already taken");
    }
  }

  const updated = await prisma.userProfile.update({
    where: { id },
    data,
  });
  // Drop the stored files this update just replaced or removed.
  if (data.profilePicture !== undefined && data.profilePicture !== existing.profilePicture) {
    await deleteUploadedFile(existing.profilePicture);
  }
  if (data.signature !== undefined && data.signature !== existing.signature) {
    await deleteUploadedFile(existing.signature);
  }
  if (data.resume !== undefined && data.resume !== existing.resume) {
    await deleteUploadedFile(existing.resume);
  }
  return withComputed(updated);
}
