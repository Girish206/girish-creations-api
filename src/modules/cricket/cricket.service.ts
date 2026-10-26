import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError } from "../../utils/httpError";
import { assertMobileFree } from "../admin-user/admin-user.service";
import { deleteUploadedFile, uploadFile } from "../../middleware/upload";
import { normalizeMobile } from "../../utils/mobile";
import { assertWithinLimit } from "../../middleware/rateLimit";

// ===== Players =====

export interface CricketPlayerInput {
  name: string;
  role?: string | null;
  mobile: string;
}

// The login account linked to a player: the account with the same mobile.
const accountForMobile = (mobile: string | null) =>
  mobile ? prisma.adminUser.findFirst({ where: { mobile } }) : Promise.resolve(null);

const canSignIntoCricket = (account: {
  isActive: boolean;
  passwordHash: string | null;
  hasCricketAccess: boolean;
  isSuperAdmin: boolean;
  isOwner: boolean;
}) => account.isActive && account.passwordHash !== null && (account.hasCricketAccess || account.isSuperAdmin || account.isOwner);

// Super admins get mobiles and whether each player can sign in; players
// only see names and roles (no one else's number).
export async function listPlayers(full: boolean) {
  const players = await prisma.cricketPlayer.findMany({ orderBy: { name: "asc" } });
  if (!full) return players.map(({ id, name, role, photoUrl }) => ({ id, name, role, photoUrl }));
  const mobiles = players.flatMap((player) => (player.mobile ? [player.mobile] : []));
  const accounts = await prisma.adminUser.findMany({ where: { mobile: { in: mobiles } } });
  return players.map((player) => {
    const account = accounts.find((a) => a.mobile === player.mobile);
    return { ...player, hasLogin: account ? canSignIntoCricket(account) : false };
  });
}

// Names can repeat (two players can both be "Ravi"); the mobile number is
// what tells players apart.
async function assertPlayerMobileFree(mobile: string, exceptId?: bigint) {
  const clash = await prisma.cricketPlayer.findFirst({
    where: { mobile, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) {
    throw ConflictError(`${clash.name} already has this mobile number`);
  }
}

export async function createPlayer(input: CricketPlayerInput) {
  await assertPlayerMobileFree(input.mobile);
  return prisma.cricketPlayer.create({ data: input });
}

// For organisers who aren't super admins (adding to their own squads): a
// number already on the list picks that player instead of clashing. Mobiles
// stay hidden, as in listPlayers(false).
export async function findOrCreatePlayer(input: CricketPlayerInput) {
  const player =
    (await prisma.cricketPlayer.findFirst({ where: { mobile: input.mobile } })) ??
    (await prisma.cricketPlayer.create({ data: input }));
  return { id: player.id, name: player.name, role: player.role, photoUrl: player.photoUrl };
}

// The player with this mobile (null = a new number), for anyone naming a
// one-off match's captain. The number isn't echoed back.
export async function lookupPlayer(mobile: string) {
  const player = await prisma.cricketPlayer.findFirst({ where: { mobile } });
  return player && { id: player.id, name: player.name, role: player.role, photoUrl: player.photoUrl };
}

// Adds a pasted list in one go, skipping anyone whose mobile is already
// taken (in the pool or earlier in the list) rather than failing the whole
// batch.
export async function createPlayersBulk(rows: { name: string; mobile: string }[]) {
  const existing = await prisma.cricketPlayer.findMany({ select: { mobile: true } });
  const mobiles = new Set(existing.flatMap((player) => (player.mobile ? [player.mobile] : [])));
  const fresh: { name: string; mobile: string }[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (mobiles.has(row.mobile)) {
      skipped.push(row.name);
      continue;
    }
    mobiles.add(row.mobile);
    fresh.push(row);
  }
  if (fresh.length > 0) {
    await prisma.cricketPlayer.createMany({ data: fresh });
  }
  return { added: fresh.length, skipped: skipped.length, skippedNames: skipped };
}

// A changed mobile carries the player's login account along with it.
export async function updatePlayer(id: bigint, input: CricketPlayerInput) {
  const existing = await prisma.cricketPlayer.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Player not found");
  }
  await assertPlayerMobileFree(input.mobile, id);
  if (existing.mobile !== input.mobile) {
    const account = await accountForMobile(existing.mobile);
    await assertMobileFree(input.mobile, account?.id);
    if (account) {
      await prisma.adminUser.update({ where: { id: account.id }, data: { mobile: input.mobile } });
    }
  }
  return prisma.cricketPlayer.update({ where: { id }, data: input });
}

// Lets a player sign in with their mobile number: creates their account
// (cricket access only), or turns cricket access on for an existing account
// with that number. The password is required unless the account has one.
export async function grantPlayerLogin(id: bigint, password: string | undefined, actorId: bigint) {
  const player = await prisma.cricketPlayer.findUnique({ where: { id } });
  if (!player) throw NotFoundError("Player not found");
  if (!player.mobile) throw BadRequestError("Add the player's mobile number first");
  const account = await accountForMobile(player.mobile);
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  if (account) {
    if (account.isOwner && passwordHash) {
      throw ForbiddenError("The owner's password can't be changed from here");
    }
    if (!account.passwordHash && !passwordHash) throw BadRequestError("Set a password for the first sign-in");
    await prisma.adminUser.update({
      where: { id: account.id },
      data: { hasCricketAccess: true, isActive: true, passwordHash },
    });
  } else {
    if (!passwordHash) throw BadRequestError("Set a password for the first sign-in");
    await prisma.adminUser.create({
      data: {
        name: player.name,
        mobile: player.mobile,
        passwordHash,
        hasCricketAccess: true,
        hasPortfolioAccess: false,
        createdByAdminUserId: actorId,
      },
    });
  }
}

// Turns cricket access off. An account that only existed for cricket is
// removed (left without a password it would show up as a Money Hub guest);
// if anything points at it, it's deactivated instead.
export async function revokePlayerLogin(id: bigint) {
  const player = await prisma.cricketPlayer.findUnique({ where: { id } });
  if (!player) throw NotFoundError("Player not found");
  const account = await accountForMobile(player.mobile);
  if (!account) return;
  const cricketOnly =
    !account.email &&
    !account.isOwner &&
    !account.isSuperAdmin &&
    !account.hasPortfolioAccess &&
    !account.hasExpensesAccess &&
    !account.hasSavingsAccess;
  if (cricketOnly) {
    try {
      await prisma.adminUser.delete({ where: { id: account.id } });
      return;
    } catch {
      await prisma.adminUser.update({
        where: { id: account.id },
        data: { hasCricketAccess: false, isActive: false },
      });
      return;
    }
  }
  await prisma.adminUser.update({ where: { id: account.id }, data: { hasCricketAccess: false } });
}

// ===== Signing up and the player's own profile =====

export interface CricketSignUpInput {
  name?: string;
  mobile: string;
  password: string;
  // Needed to claim a player someone else added (see CricketPlayer.inviteCode).
  inviteCode?: string;
}

// The sign-in screen's first step: from the mobile number or email typed,
// which step comes next. "password" for an account that signs in already,
// "setPassword" for a number an organiser added (or a guest account) with
// no password yet — claimed with the invite code the organiser shares —
// and "register" for a new number. An email can't sign up. The player's
// name isn't given out: anyone can ask about any number.
export type SignInStep = "password" | "setPassword" | "register";

export async function lookupSignIn(identifier: string): Promise<{ step: SignInStep; name: null }> {
  if (identifier.includes("@")) {
    const account = await prisma.adminUser.findUnique({ where: { email: identifier.toLowerCase() } });
    if (!account) throw NotFoundError("No account uses this email. Use your mobile number to create one.");
    return { step: "password", name: null };
  }
  const mobile = normalizeMobile(identifier);
  if (!mobile) throw BadRequestError("Enter a valid 10-digit mobile number or your email");

  // Same rules as signUp: an inactive or passworded account signs in.
  const account = await accountForMobile(mobile);
  if (account && (account.passwordHash !== null || !account.isActive)) {
    return { step: "password", name: null };
  }
  const player = await prisma.cricketPlayer.findFirst({ where: { mobile } });
  return { step: player || account ? "setPassword" : "register", name: null };
}

// Anyone can create a player account with their name, mobile number and a
// password. A number someone already added (a player an organiser or
// captain put in a team) is claimed only with the invite code they were
// given, so knowing a teammate's number isn't enough to become them. A new
// number gets a new player.
export async function signUp(input: CricketSignUpInput) {
  const existing = await accountForMobile(input.mobile);
  if (existing && (existing.passwordHash !== null || !existing.isActive)) {
    throw ConflictError("An account with this mobile number already exists. Sign in instead.");
  }
  const player = await prisma.cricketPlayer.findFirst({ where: { mobile: input.mobile } });
  if (existing && !player) {
    // A Money Hub guest: not a cricket player, and no invite to check.
    throw ForbiddenError("This number is already on a Girish Creations account. Ask whoever added it to give it access.");
  }
  if (player) {
    // Six digits: a handful of tries per number, then a wait.
    await assertWithinLimit(`invite-code:${input.mobile}`, 5, 15 * 60_000);
    if (!player.inviteCode || input.inviteCode?.trim() !== player.inviteCode) {
      throw new HttpError(
        400,
        player.inviteCode
          ? "That invite code isn't right. Check the code the organiser who added you sent."
          : "Ask the organiser or captain who added you to send you an invite code.",
        "INVITE_CODE",
      );
    }
  }
  const name = input.name ?? player?.name ?? existing?.name;
  if (!name) throw BadRequestError("Enter your name");
  const passwordHash = await bcrypt.hash(input.password, 10);
  const account = existing
    ? await prisma.adminUser.update({
        where: { id: existing.id },
        data: { name: existing.name ?? name, passwordHash, hasCricketAccess: true },
      })
    : await prisma.adminUser.create({
        data: {
          name,
          mobile: input.mobile,
          passwordHash,
          hasCricketAccess: true,
          hasPortfolioAccess: false,
        },
      });
  if (player) {
    await prisma.cricketPlayer.update({ where: { id: player.id }, data: { inviteCode: null } });
  } else {
    await prisma.cricketPlayer.create({ data: { name, mobile: input.mobile } });
  }
  return account;
}

const newInviteCode = () => String(randomInt(100000, 1000000));

// Who may hand a player their invite code: super admins, and anyone who
// added them somewhere — the organiser of a tournament, match or saved team
// they're in, or the captain of their side.
async function canInvite(playerId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return true;
  const me = await findMyPlayer(viewer.adminId);
  const captainOf = me ? [{ teams: { some: { captainId: me.id, playerIds: { has: playerId } } } }] : [];
  const [tournaments, matches, savedTeams] = await Promise.all([
    prisma.cricketTournament.count({
      where: { OR: [{ createdById: viewer.adminId, playerIds: { has: playerId } }, ...captainOf] },
    }),
    prisma.cricketMatch.count({
      where: { OR: [{ createdById: viewer.adminId, teams: { some: { playerIds: { has: playerId } } } }, ...captainOf] },
    }),
    prisma.cricketSavedTeam.count({
      where: { playerIds: { has: playerId }, OR: [{ createdById: viewer.adminId }, ...(me ? [{ captainId: me.id }] : [])] },
    }),
  ]);
  return tournaments + matches + savedTeams > 0;
}

// The player's invite code (made the first time it's asked for), for the
// organiser to send them. Players who already sign in don't need one.
export async function playerInvite(playerId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  const player = await prisma.cricketPlayer.findUnique({ where: { id: playerId } });
  if (!player) throw NotFoundError("Player not found");
  if (!(await canInvite(playerId, viewer))) {
    throw ForbiddenError("Only the organiser or captain who added this player can invite them");
  }
  const account = await accountForMobile(player.mobile);
  if (account && account.passwordHash !== null) {
    throw ConflictError(`${player.name} already signs in to CricDesk`);
  }
  const code = player.inviteCode ?? newInviteCode();
  if (!player.inviteCode) await prisma.cricketPlayer.update({ where: { id: playerId }, data: { inviteCode: code } });
  return { playerId, name: player.name, code };
}

// A player who forgot their password: a super admin clears it, which signs
// them out everywhere, and gets a fresh invite code to send them so they can
// set a new one. Accounts also used for the other Girish Creations apps are
// reset there instead.
export async function resetPlayerLogin(playerId: bigint) {
  const player = await prisma.cricketPlayer.findUnique({ where: { id: playerId } });
  if (!player) throw NotFoundError("Player not found");
  const account = await accountForMobile(player.mobile);
  if (account) {
    const cricketOnly =
      !account.email &&
      !account.isOwner &&
      !account.isSuperAdmin &&
      !account.hasPortfolioAccess &&
      !account.hasExpensesAccess &&
      !account.hasSavingsAccess;
    if (!cricketOnly) throw ForbiddenError("This account is also used for Girish Creations — reset its password there");
    await prisma.adminUser.update({
      where: { id: account.id },
      data: { passwordHash: null, sessionVersion: { increment: 1 } },
    });
  }
  const code = newInviteCode();
  await prisma.cricketPlayer.update({ where: { id: playerId }, data: { inviteCode: code } });
  return { playerId, name: player.name, code };
}

export interface CricketProfileInput {
  name: string;
  mobile: string;
  role?: string | null;
  // Both needed to change the password.
  currentPassword?: string;
  newPassword?: string;
}

// The signed-in user edits their own name, mobile, playing role and
// password. Name and mobile are kept the same on the account and its
// player (the mobile is what links the two).
export async function updateMyProfile(adminId: bigint, input: CricketProfileInput) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!account) throw NotFoundError("Account not found");
  const player = await findMyPlayer(adminId);

  if (input.mobile !== account.mobile) {
    await assertMobileFree(input.mobile, account.id);
    await assertPlayerMobileFree(input.mobile, player?.id);
  }

  let passwordHash: string | undefined;
  if (input.newPassword) {
    const valid = account.passwordHash && (await bcrypt.compare(input.currentPassword ?? "", account.passwordHash));
    // 400 rather than 401, which the app treats as "signed out".
    if (!valid) throw BadRequestError("Your current password isn't right");
    passwordHash = await bcrypt.hash(input.newPassword, 10);
  }

  const updated = await prisma.adminUser.update({
    where: { id: account.id },
    data: { name: input.name, mobile: input.mobile, passwordHash },
  });
  if (player) {
    await prisma.cricketPlayer.update({
      where: { id: player.id },
      data: { name: input.name, mobile: input.mobile, ...(input.role !== undefined ? { role: input.role } : {}) },
    });
  }
  return updated;
}

// The signed-in player's own photo.
export async function setMyPhoto(adminId: bigint, photo: Express.Multer.File | undefined, remove: boolean) {
  const player = await findMyPlayer(adminId);
  if (!player) throw NotFoundError("Your player profile isn't set up yet");
  return setPlayerPhoto(player.id, photo, remove);
}

// ===== The signed-in player =====

export async function findMyPlayer(adminId: bigint) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!account?.mobile) return null;
  return prisma.cricketPlayer.findFirst({ where: { mobile: account.mobile } });
}

// The signed-in user's player record plus the tournaments they're in and
// the matches they've been picked for — enough for "My Stats", "My
// Matches" and "My Tournaments". The followed* lists add the tournaments
// they follow (directly or through a team), those tournaments' matches (a
// followed team's only) and the matches of players they follow, leaving out
// ones they play in. created* are the ones they organise and scoring* the
// ones they were made a scorer of.
export async function getMe(adminId: bigint) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  const player = await findMyPlayer(adminId);
  const [createdTournaments, createdMatches] = await Promise.all([
    // Co-organised ones count as theirs too.
    prisma.cricketTournament.findMany({
      where: { OR: [{ createdById: adminId }, ...(player ? [{ organiserIds: { has: player.id } }] : [])] },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cricketMatch.findMany({
      where: { createdById: adminId },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  if (!player) {
    return {
      player: null,
      accountMobile: account?.mobile ?? null,
      createdTournaments,
      createdMatches,
      tournaments: [],
      matches: [],
      followedTournaments: [],
      followedMatches: [],
      followedPlayerMatches: [],
      scoringTournaments: [],
      scoringMatches: [],
      savedTeams: await prisma.cricketSavedTeam.findMany({ where: { createdById: adminId }, orderBy: { createdAt: "desc" } }),
    };
  }
  const allFollows = await prisma.cricketFollow.findMany({ where: { followerId: player.id } });
  const follows = allFollows.filter((f) => f.kind === "tournament" || f.kind === "team");
  const followedPlayerIds = allFollows.filter((f) => f.kind === "player").map((f) => f.targetId);
  const followedIds = [...new Set(follows.map((f) => f.targetId))];
  const followedMatchWhere = [
    { tournamentId: { in: follows.filter((f) => f.kind === "tournament").map((f) => f.targetId) } },
    ...follows
      .filter((f) => f.kind === "team" && f.teamIndex !== null)
      .map((f) => ({ tournamentId: f.targetId, teams: { some: { teamIndex: f.teamIndex! } } })),
  ];
  const notMine = { NOT: { teams: { some: { playerIds: { has: player.id } } } } };
  // What they've been made a scorer of (a tournament's scorers score all its matches).
  const scoringTournaments = await prisma.cricketTournament.findMany({
    where: { scorerIds: { has: player.id } },
    orderBy: { createdAt: "desc" },
  });
  const scoringMatches = await prisma.cricketMatch.findMany({
    where: {
      OR: [{ scorerIds: { has: player.id } }, { tournamentId: { in: scoringTournaments.map((t) => t.id) } }],
    },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
  });
  const [tournaments, matches, followedTournaments, followedMatches, followedPlayerMatches] = await Promise.all([
    prisma.cricketTournament.findMany({ where: { playerIds: { has: player.id } }, orderBy: { createdAt: "desc" } }),
    prisma.cricketMatch.findMany({
      where: { teams: { some: { playerIds: { has: player.id } } } },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    }),
    followedIds.length
      ? prisma.cricketTournament.findMany({
          where: { id: { in: followedIds }, NOT: { playerIds: { has: player.id } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    follows.length
      ? prisma.cricketMatch.findMany({
          where: { OR: followedMatchWhere, ...notMine },
          orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        })
      : [],
    followedPlayerIds.length
      ? prisma.cricketMatch.findMany({
          where: { teams: { some: { playerIds: { hasSome: followedPlayerIds } } }, ...notMine },
          orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        })
      : [],
  ]);
  return {
    player,
    accountMobile: account?.mobile ?? null,
    tournaments,
    matches,
    followedTournaments,
    followedMatches,
    followedPlayerMatches,
    createdTournaments,
    createdMatches,
    scoringTournaments,
    scoringMatches,
    // Teams made outside a tournament that they created or play for.
    savedTeams: await prisma.cricketSavedTeam.findMany({
      where: { OR: [{ createdById: adminId }, { playerIds: { has: player.id } }] },
      orderBy: { createdAt: "desc" },
    }),
  };
}

// Any player's career, for their profile: the matches they've been picked
// for and the tournaments they're in. Only the matches the viewer could
// open themselves (see assertCanViewMatch) are included.
export async function getPlayerCareer(playerId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  const player = await prisma.cricketPlayer.findUnique({ where: { id: playerId } });
  if (!player) throw NotFoundError("Player not found");
  const [matches, tournaments] = await Promise.all([
    prisma.cricketMatch.findMany({
      where: { teams: { some: { playerIds: { has: playerId } } } },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.cricketTournament.findMany({ where: { playerIds: { has: playerId } }, orderBy: { createdAt: "desc" } }),
  ]);
  const canView = await matchViewCheck(viewer);
  return { matches: matches.filter(canView), tournaments: tournaments.map((t) => withoutContacts(t, viewer)) };
}

// assertCanViewMatch for many matches at once: what the viewer follows and
// takes part in is read once, then each match is checked in memory.
export async function matchViewCheck(viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  type Viewable = {
    tournamentId: bigint | null;
    createdById: bigint | null;
    scorerIds: bigint[];
    teams: { playerIds: bigint[] }[];
  };
  if (viewer.isSuperAdmin) return (_match: Viewable) => true;
  const player = await findMyPlayer(viewer.adminId);
  const [follows, tournaments] = await Promise.all([
    player ? prisma.cricketFollow.findMany({ where: { followerId: player.id } }) : [],
    prisma.cricketTournament.findMany({
      where: {
        OR: [
          { createdById: viewer.adminId },
          ...(player
            ? [{ playerIds: { has: player.id } }, { scorerIds: { has: player.id } }, { organiserIds: { has: player.id } }]
            : []),
        ],
      },
      select: { id: true },
    }),
  ]);
  const followedPlayers = new Set(follows.filter((f) => f.kind === "player").map((f) => f.targetId));
  const openTournaments = new Set([
    ...tournaments.map((t) => t.id),
    ...follows.filter((f) => f.kind !== "player").map((f) => f.targetId),
  ]);
  return (match: Viewable) => {
    if (match.createdById === viewer.adminId) return true;
    if (player && match.scorerIds.includes(player.id)) return true;
    const playerIds = match.teams.flatMap((team) => team.playerIds);
    if (playerIds.some((id) => followedPlayers.has(id))) return true;
    if (match.tournamentId !== null) return openTournaments.has(match.tournamentId);
    return player !== null && playerIds.includes(player.id);
  };
}

// The organiser's phone and email are for the people in a tournament (its
// page needs a follow); the full list everyone browses leaves them out.
export function withoutContacts<T extends { createdById: bigint | null; organiserMobile: string | null; organiserEmail: string | null }>(
  tournament: T,
  viewer: { adminId: bigint; isSuperAdmin: boolean },
): T {
  if (viewer.isSuperAdmin || tournament.createdById === viewer.adminId) return tournament;
  return { ...tournament, organiserMobile: null, organiserEmail: null };
}

// A player (not a super admin) may only look at tournaments they're in or
// follow (the tournament or one of its teams).
export async function assertCanViewTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return;
  if (await prisma.cricketTournament.count({ where: { id: tournamentId, createdById: viewer.adminId } })) return;
  const player = await findMyPlayer(viewer.adminId);
  const [tournament, follow] = player
    ? await Promise.all([
        // Its squad, its scorers and its co-organisers.
        prisma.cricketTournament.findFirst({
          where: {
            id: tournamentId,
            OR: [{ playerIds: { has: player.id } }, { scorerIds: { has: player.id } }, { organiserIds: { has: player.id } }],
          },
        }),
        prisma.cricketFollow.findFirst({
          where: { followerId: player.id, kind: { in: ["tournament", "team"] }, targetId: tournamentId },
        }),
      ])
    : [null, null];
  if (!tournament && !follow) {
    throw ForbiddenError("Follow this tournament to see it");
  }
}

// A match is also open to a player who follows someone playing in it. A
// standalone match is otherwise open only to its own players.
export async function assertCanViewMatch(
  match: {
    tournamentId: bigint | null;
    createdById: bigint | null;
    scorerIds: bigint[];
    teams: { playerIds: bigint[] }[];
  },
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  if (viewer.isSuperAdmin || match.createdById === viewer.adminId) return;
  const player = await findMyPlayer(viewer.adminId);
  if (player && match.scorerIds.includes(player.id)) return;
  const playerIds = match.teams.flatMap((team) => team.playerIds);
  const follow = player
    ? await prisma.cricketFollow.findFirst({
        where: { followerId: player.id, kind: "player", targetId: { in: playerIds } },
      })
    : null;
  if (follow) return;
  if (match.tournamentId !== null) return assertCanViewTournament(match.tournamentId, viewer);
  if (!player || !playerIds.includes(player.id)) {
    throw ForbiddenError("Follow a player in this match to see it");
  }
}

// Who may change a tournament (its details, squad, teams, fixtures): super
// admins, the account that created it, and the co-organisers it names.
export async function canManageTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return true;
  if ((await prisma.cricketTournament.count({ where: { id: tournamentId, createdById: viewer.adminId } })) > 0) return true;
  const player = await findMyPlayer(viewer.adminId);
  return player !== null && (await prisma.cricketTournament.count({ where: { id: tournamentId, organiserIds: { has: player.id } } })) > 0;
}

export async function assertCanManageTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (!(await canManageTournament(tournamentId, viewer))) {
    throw ForbiddenError("Only the tournament's organiser can change it");
  }
}

// Who may do what with a match:
// - "organise" (delete it): its creator, its tournament's creator and super
//   admins.
// - "captain" (also choose its scorers): those, plus either side's captain.
// - "score" (also edit, start and score it): those, plus its scorers and its
//   tournament's scorers.
export type MatchAccess = "organise" | "captain" | "score";

export async function matchAccessOf(
  matchId: bigint,
  viewer: { adminId: bigint; isSuperAdmin: boolean },
): Promise<MatchAccess | null> {
  if (viewer.isSuperAdmin) return "organise";
  const match = await prisma.cricketMatch.findUnique({ where: { id: matchId } });
  if (!match) throw NotFoundError("Match not found");
  if (match.createdById === viewer.adminId) return "organise";
  if (match.tournamentId !== null && (await canManageTournament(match.tournamentId, viewer))) return "organise";
  const player = await findMyPlayer(viewer.adminId);
  if (!player) return null;
  if (match.teams.some((team) => team.captainId === player.id)) return "captain";
  if (match.scorerIds.includes(player.id)) return "score";
  if (
    match.tournamentId !== null &&
    (await prisma.cricketTournament.count({ where: { id: match.tournamentId, scorerIds: { has: player.id } } }))
  ) {
    return "score";
  }
  return null;
}

const ACCESS_RANK: Record<MatchAccess, number> = { score: 0, captain: 1, organise: 2 };

export async function assertMatchAccess(
  matchId: bigint,
  viewer: { adminId: bigint; isSuperAdmin: boolean },
  needed: MatchAccess,
) {
  const access = await matchAccessOf(matchId, viewer);
  if (access && ACCESS_RANK[access] >= ACCESS_RANK[needed]) return;
  throw ForbiddenError(
    needed === "organise"
      ? "Only the match's organiser can do that"
      : needed === "captain"
        ? "Only the organiser or a captain can choose the scorers"
        : "Only the organiser, the captains and the scorers can change this match",
  );
}

// Scorers are players (anyone with an account linked to them can score).
async function assertPlayersExist(playerIds: bigint[]) {
  const found = await prisma.cricketPlayer.count({ where: { id: { in: playerIds } } });
  if (found !== new Set(playerIds).size) throw BadRequestError("Unknown player");
}

export async function setMatchScorers(id: bigint, playerIds: bigint[]) {
  await assertPlayersExist(playerIds);
  return prisma.cricketMatch.update({ where: { id }, data: { scorerIds: [...new Set(playerIds)] } });
}

export async function setTournamentScorers(id: bigint, playerIds: bigint[]) {
  await assertPlayersExist(playerIds);
  return prisma.cricketTournament.update({ where: { id }, data: { scorerIds: [...new Set(playerIds)] } });
}

// Co-organisers: players who manage the tournament alongside its creator.
export async function setTournamentOrganisers(id: bigint, playerIds: bigint[]) {
  await assertPlayersExist(playerIds);
  return prisma.cricketTournament.update({ where: { id }, data: { organiserIds: [...new Set(playerIds)] } });
}

// A new photo replaces the old one (whose file is deleted); no file and
// `remove` clears it.
export async function setPlayerPhoto(id: bigint, photo: Express.Multer.File | undefined, remove: boolean) {
  const existing = await prisma.cricketPlayer.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Player not found");
  }
  if (!photo && !remove) return existing;
  if (photo && !photo.mimetype.startsWith("image/")) throw BadRequestError("The photo must be an image");
  const photoUrl = photo ? await uploadFile(photo) : null;
  const updated = await prisma.cricketPlayer.update({ where: { id }, data: { photoUrl } });
  await deleteUploadedFile(existing.photoUrl);
  return updated;
}

export async function deletePlayer(id: bigint) {
  const existing = await prisma.cricketPlayer.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Player not found");
  }
  const inUse = await prisma.cricketTournament.findFirst({
    where: {
      OR: [
        { playerIds: { has: id } },
        { matchSets: { some: { playerIds: { has: id } } } },
        { teams: { some: { playerIds: { has: id } } } },
      ],
    },
    select: { name: true, teams: true },
  });
  if (inUse) {
    const team = inUse.teams.find((t) => t.playerIds.includes(id));
    throw ConflictError(
      team
        ? `This player is on ${team.name} in the "${inUse.name}" tournament — remove them from it first`
        : `This player is still in the squad of the "${inUse.name}" tournament — remove them from the tournament first`,
    );
  }
  const playedIn = await prisma.cricketMatch.count({ where: { teams: { some: { playerIds: { has: id } } } } });
  if (playedIn > 0) {
    throw ConflictError("This player has played in matches, so their record can't be deleted — merge it into another instead");
  }
  await prisma.cricketPlayer.delete({ where: { id } });
  await prisma.cricketFollow.deleteMany({ where: { OR: [{ followerId: id }, { kind: "player", targetId: id }] } });
  await dropPlayerEverywhere(id, null);
  await revokePlayerLoginFor(existing.mobile);
  await deleteUploadedFile(existing.photoUrl);
}

// Swaps (or, with `into` null, removes) a player id everywhere else it's
// kept: scorer and co-organiser lists, and saved teams.
async function dropPlayerEverywhere(id: bigint, into: bigint | null) {
  const swap = (ids: bigint[]) => [...new Set(ids.flatMap((x) => (x === id ? (into === null ? [] : [into]) : [x])))];
  const role = (x: bigint | null) => (x === id ? into : x);
  for (const t of await prisma.cricketTournament.findMany({
    where: { OR: [{ scorerIds: { has: id } }, { organiserIds: { has: id } }] },
  })) {
    await prisma.cricketTournament.update({
      where: { id: t.id },
      data: { scorerIds: swap(t.scorerIds), organiserIds: swap(t.organiserIds) },
    });
  }
  for (const m of await prisma.cricketMatch.findMany({ where: { scorerIds: { has: id } } })) {
    await prisma.cricketMatch.update({ where: { id: m.id }, data: { scorerIds: swap(m.scorerIds) } });
  }
  for (const team of await prisma.cricketSavedTeam.findMany({ where: { playerIds: { has: id } } })) {
    await prisma.cricketSavedTeam.update({
      where: { id: team.id },
      data: {
        playerIds: swap(team.playerIds),
        captainId: role(team.captainId),
        viceCaptainId: role(team.viceCaptainId),
        keeperId: role(team.keeperId),
      },
    });
  }
}

// A deleted player's sign-in goes with them (it's a cricket-only account).
async function revokePlayerLoginFor(mobile: string | null) {
  const account = await accountForMobile(mobile);
  if (account && !account.email && !account.isOwner && !account.isSuperAdmin && !account.hasPortfolioAccess && !account.hasExpensesAccess && !account.hasSavingsAccess) {
    await prisma.adminUser.update({
      where: { id: account.id },
      data: { hasCricketAccess: false, isActive: false, sessionVersion: { increment: 1 } },
    });
  }
}

// One person added twice (two numbers, or before mobiles were required):
// everything recorded for `fromId` — squads, teams, every ball, awards,
// follows — moves to `intoId`, and `fromId` is deleted. Super admins only.
export async function mergePlayers(fromId: bigint, intoId: bigint) {
  if (fromId === intoId) throw BadRequestError("Pick two different players");
  const [from, into] = await Promise.all([
    prisma.cricketPlayer.findUnique({ where: { id: fromId } }),
    prisma.cricketPlayer.findUnique({ where: { id: intoId } }),
  ]);
  if (!from || !into) throw NotFoundError("Player not found");
  const swap = (ids: bigint[]) => [...new Set(ids.map((x) => (x === fromId ? intoId : x)))];
  const one = (x: bigint | null) => (x === fromId ? intoId : x);

  for (const t of await prisma.cricketTournament.findMany({ where: { playerIds: { has: fromId } } })) {
    if (t.teams.some((team) => team.playerIds.includes(fromId)) && t.teams.some((team) => team.playerIds.includes(intoId))) {
      const a = t.teams.find((team) => team.playerIds.includes(fromId))!;
      const b = t.teams.find((team) => team.playerIds.includes(intoId))!;
      if (a !== b) throw ConflictError(`They're on different teams in "${t.name}" — move one of them first`);
    }
    await prisma.cricketTournament.update({
      where: { id: t.id },
      data: {
        playerIds: swap(t.playerIds),
        matchSets: t.matchSets.map((set) => ({ playerIds: swap(set.playerIds) })),
        teams: t.teams.map((team) => ({
          ...team,
          playerIds: swap(team.playerIds),
          captainId: one(team.captainId),
          viceCaptainId: one(team.viceCaptainId),
          keeperId: one(team.keeperId),
        })),
      },
    });
  }
  for (const m of await prisma.cricketMatch.findMany({
    where: { OR: [{ teams: { some: { playerIds: { has: fromId } } } }, { playerOfMatchId: fromId }] },
  })) {
    const sides = m.teams.filter((team) => team.playerIds.includes(fromId) || team.playerIds.includes(intoId));
    if (sides.length === 2 && sides[0] !== sides[1] && sides.every((s) => s.playerIds.includes(fromId) !== s.playerIds.includes(intoId))) {
      throw ConflictError("They played against each other in a match, so they can't be the same person");
    }
    await prisma.cricketMatch.update({
      where: { id: m.id },
      data: {
        playerOfMatchId: one(m.playerOfMatchId),
        teams: m.teams.map((team) => ({
          ...team,
          playerIds: swap(team.playerIds),
          captainId: one(team.captainId),
          viceCaptainId: one(team.viceCaptainId),
          keeperId: one(team.keeperId),
        })),
        innings: m.innings.map((innings) => ({
          ...innings,
          strikerId: one(innings.strikerId),
          nonStrikerId: one(innings.nonStrikerId),
          bowlerId: one(innings.bowlerId),
          balls: innings.balls.map((ball) => ({
            ...ball,
            batterId: one(ball.batterId)!,
            nonStrikerId: one(ball.nonStrikerId)!,
            bowlerId: one(ball.bowlerId)!,
            dismissedId: one(ball.dismissedId),
            fielderId: one(ball.fielderId),
            secondFielderId: one(ball.secondFielderId),
          })),
        })),
      },
    });
  }
  await dropPlayerEverywhere(fromId, intoId);
  await prisma.cricketFollow.updateMany({ where: { followerId: fromId }, data: { followerId: intoId } });
  await prisma.cricketFollow.updateMany({ where: { kind: "player", targetId: fromId }, data: { targetId: intoId } });
  await prisma.cricketPlayer.delete({ where: { id: fromId } });
  await revokePlayerLoginFor(from.mobile);
  if (!into.photoUrl && from.photoUrl) {
    await prisma.cricketPlayer.update({ where: { id: intoId }, data: { photoUrl: from.photoUrl } });
  } else {
    await deleteUploadedFile(from.photoUrl);
  }
  return prisma.cricketPlayer.findUnique({ where: { id: intoId } });
}

// ===== Tournaments =====

export interface CricketTournamentInput {
  name: string;
  city?: string | null;
  ground?: string | null;
  organiserName?: string | null;
  organiserMobile?: string | null;
  organiserEmail?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  category?: string | null;
  ballType?: string | null;
  pitchType?: string | null;
  matchType?: string | null;
  overs?: number | null;
  // Default playing conditions for its matches; left out keeps them.
  ballsPerOver?: number | null;
  bowlerOverLimit?: number | null;
  lastManStands?: boolean | null;
  freeHit?: boolean | null;
  // Left out keeps them as they are.
  finished?: boolean;
  isPublic?: boolean;
}

const CONDITIONS = ["ballsPerOver", "bowlerOverLimit", "lastManStands", "freeHit"] as const;

// The playing conditions given (an older client sends none, keeping them).
const conditionsOf = (input: CricketTournamentInput) =>
  Object.fromEntries(CONDITIONS.flatMap((key) => (input[key] !== undefined ? [[key, input[key]]] : []))) as Partial<
    Pick<CricketTournamentInput, (typeof CONDITIONS)[number]>
  >;

// The descriptive fields, with anything left out cleared.
const tournamentDetails = (input: CricketTournamentInput) => ({
  city: input.city ?? null,
  ground: input.ground ?? null,
  organiserName: input.organiserName ?? null,
  organiserMobile: input.organiserMobile ?? null,
  organiserEmail: input.organiserEmail ?? null,
  startDate: input.startDate ?? null,
  endDate: input.endDate ?? null,
  category: input.category ?? null,
  ballType: input.ballType ?? null,
  pitchType: input.pitchType ?? null,
  matchType: input.matchType ?? null,
  overs: input.overs ?? null,
});

export async function listTournaments(viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  const tournaments = await prisma.cricketTournament.findMany({ orderBy: { createdAt: "desc" } });
  return tournaments.map((tournament) => withoutContacts(tournament, viewer));
}

async function getTournamentOrThrow(id: bigint) {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id } });
  if (!tournament) {
    throw NotFoundError("Tournament not found");
  }
  return tournament;
}

type Tournament = Awaited<ReturnType<typeof getTournamentOrThrow>>;

export async function getTournament(id: bigint) {
  return getTournamentOrThrow(id);
}

export async function createTournament(input: CricketTournamentInput, createdById: bigint) {
  return prisma.cricketTournament.create({
    data: {
      name: input.name,
      createdById,
      ...tournamentDetails(input),
      playerIds: [],
      // Teams are added on the tournament's Teams tab.
      teams: [],
      matchSets: [],
      ...conditionsOf(input),
    },
  });
}

// Teams aren't touched here — see the team functions below. Fixtures not
// played yet that still had the old overs or ground take the new ones.
export async function updateTournament(id: bigint, input: CricketTournamentInput) {
  const tournament = await getTournamentOrThrow(id);
  const details = tournamentDetails(input);
  if (details.overs !== null && details.overs !== tournament.overs) {
    await prisma.cricketMatch.updateMany({
      where: { tournamentId: id, status: "scheduled", ...(tournament.overs !== null ? { overs: tournament.overs } : {}) },
      data: { overs: details.overs },
    });
  }
  if (details.ground !== tournament.ground) {
    await prisma.cricketMatch.updateMany({
      where: { tournamentId: id, status: "scheduled", venue: tournament.ground },
      data: { venue: details.ground },
    });
  }
  // A changed playing condition reaches the fixtures not played yet that
  // still had the old one.
  const conditions = conditionsOf(input);
  for (const key of CONDITIONS) {
    const next = conditions[key];
    const old = tournament[key];
    if (next === undefined || next === old) continue;
    const scheduled = await prisma.cricketMatch.findMany({ where: { tournamentId: id, status: "scheduled" } });
    const stillOld = scheduled.filter((match) => (match[key] ?? null) === (old ?? null)).map((match) => match.id);
    if (stillOld.length) {
      await prisma.cricketMatch.updateMany({ where: { id: { in: stillOld } }, data: { [key]: next } });
    }
  }
  return prisma.cricketTournament.update({
    where: { id },
    data: {
      name: input.name,
      ...details,
      ...conditions,
      ...(input.finished !== undefined ? { finishedAt: input.finished ? (tournament.finishedAt ?? new Date()) : null } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
    },
  });
}

// Writes a tournament's teams / squad on top of the copy they were worked
// out from: if someone else changed it since (an organiser and a captain at
// once), nothing is written and they're asked to try again. Fixtures not
// played yet follow their teams' new rosters.
async function saveTournament(tournament: Tournament, data: Prisma.CricketTournamentUpdateManyMutationInput) {
  const version = tournament.version ?? 0;
  const { count } = await prisma.cricketTournament.updateMany({
    where: {
      id: tournament.id,
      OR: version === 0 ? [{ version: 0 }, { version: null }, { version: { isSet: false } }] : [{ version }],
    },
    data: { ...data, version: version + 1 },
  });
  if (count === 0) throw ConflictError("Someone else just changed this tournament — reload and try again");
  const saved = await getTournamentOrThrow(tournament.id);
  if (data.teams !== undefined) await syncScheduledRosters(saved);
  return saved;
}

// A fixture copies its teams' rosters when it's made; until it starts, it
// keeps up with them (a player moved to another team, a new player added).
async function syncScheduledRosters(tournament: Tournament) {
  const scheduled = await prisma.cricketMatch.findMany({ where: { tournamentId: tournament.id, status: "scheduled" } });
  for (const match of scheduled) {
    const teams = match.teams.map((side) => {
      const team = tournament.teams[side.teamIndex];
      return team ? { ...side, name: team.name, playerIds: team.playerIds, ...rolesWithin(team, team.playerIds) } : side;
    });
    if (JSON.stringify(teams) !== JSON.stringify(match.teams)) {
      await prisma.cricketMatch.update({ where: { id: match.id }, data: { teams } });
    }
  }
}

// A new logo / banner replaces the old one (whose file is deleted); the
// remove flags clear one without a replacement.
export async function setTournamentImages(
  id: bigint,
  input: { logo?: Express.Multer.File; banner?: Express.Multer.File; removeLogo: boolean; removeBanner: boolean },
) {
  const tournament = await getTournamentOrThrow(id);
  const data: { logoUrl?: string | null; bannerUrl?: string | null } = {};
  if (input.logo) {
    if (!input.logo.mimetype.startsWith("image/")) throw BadRequestError("The logo must be an image");
    data.logoUrl = await uploadFile(input.logo);
  } else if (input.removeLogo) data.logoUrl = null;
  if (input.banner) {
    if (!input.banner.mimetype.startsWith("image/")) throw BadRequestError("The banner must be an image");
    data.bannerUrl = await uploadFile(input.banner);
  } else if (input.removeBanner) data.bannerUrl = null;
  const updated = await prisma.cricketTournament.update({ where: { id }, data });
  if (data.logoUrl !== undefined) await deleteUploadedFile(tournament.logoUrl);
  if (data.bannerUrl !== undefined) await deleteUploadedFile(tournament.bannerUrl);
  return updated;
}

// Its fixtures, follows (and uploaded images) go with it. Matches that were
// played stay, as one-off matches, so nobody's career stats are lost.
export async function deleteTournament(id: bigint) {
  const tournament = await getTournamentOrThrow(id);
  const matches = await prisma.cricketMatch.findMany({ where: { tournamentId: id } });
  const played = matches.filter((m) => m.status === "completed" || m.innings.some((innings) => innings.balls.length > 0));
  for (const match of played) {
    await prisma.cricketMatch.update({
      where: { id: match.id },
      data: {
        tournamentId: null,
        phaseId: null,
        group: null,
        slot: null,
        // Same team key the sides had in the tournament (effectiveTeamKey).
        teams: match.teams.map((side) => ({ ...side, teamKey: side.teamKey ?? `t:${id}:${side.teamIndex}` })),
      },
    });
  }
  await prisma.cricketMatch.deleteMany({ where: { tournamentId: id } });
  await prisma.cricketFollow.deleteMany({ where: { kind: { in: ["tournament", "team"] }, targetId: id } });
  await prisma.cricketTeamInvite.deleteMany({ where: { tournamentId: id } });
  await prisma.cricketTournament.delete({ where: { id } });
  await deleteUploadedFile(tournament.logoUrl);
  await deleteUploadedFile(tournament.bannerUrl);
}

// Replaces the squad. Anyone dropped from it is also taken out of their
// matched set (an emptied set goes away); the generated teams are left as
// they are and the page flags them as out of date.
export async function setSquad(id: bigint, playerIds: bigint[]) {
  const tournament = await getTournamentOrThrow(id);
  const squad = [...new Set(playerIds)];
  const known = await prisma.cricketPlayer.count({ where: { id: { in: squad } } });
  if (known !== squad.length) {
    throw BadRequestError("Some of these players no longer exist");
  }
  const inSquad = new Set(squad);
  return saveTournament(tournament, {
      playerIds: squad,
      // Anyone taken out of the squad leaves their team too (and any
      // captain / vice-captain / keeper role on it).
      teams: tournament.teams.map((team) =>
        teamFrom({ ...team, playerIds: team.playerIds.filter((playerId) => inSquad.has(playerId)) }, team),
      ),
      matchSets: tournament.matchSets
        .map((set) => ({ playerIds: set.playerIds.filter((playerId) => inSquad.has(playerId)) }))
        .filter((set) => set.playerIds.length > 0),
  });
}

// Replaces the tournament's matched sets. Each set holds 1..teamCount
// distinct squad players, and no player may appear in two sets.
export async function setMatchSets(id: bigint, sets: bigint[][]) {
  const tournament = await getTournamentOrThrow(id);
  // Sets are dealt out over the generated teams only; players already on a
  // hand-built team stay there.
  const teamCount = tournament.teams.filter((team) => !team.manual).length;
  const inSquad = new Set(tournament.playerIds);
  const onManualTeam = new Set(tournament.teams.filter((team) => team.manual).flatMap((team) => team.playerIds));
  const seen = new Set<bigint>();
  for (const set of sets) {
    if (set.length > teamCount) {
      throw BadRequestError(`A matched set can hold at most ${teamCount} players (one per generated team)`);
    }
    for (const playerId of set) {
      if (!inSquad.has(playerId)) {
        throw BadRequestError("Only players in the tournament's squad can be matched");
      }
      if (onManualTeam.has(playerId)) {
        throw BadRequestError("Players on a hand-built team can't be matched");
      }
      if (seen.has(playerId)) {
        throw BadRequestError("A player can only be in one matched set");
      }
      seen.add(playerId);
    }
  }
  return saveTournament(tournament, { matchSets: sets.map((playerIds) => ({ playerIds })) });
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Deals every matched set out across the teams: its players are shuffled
// and each goes to a different team. Full sets give every team one player;
// a short set fills the teams with the fewest players first (ties broken at
// random), keeping team sizes within one of each other.
export async function generateTeams(id: bigint) {
  const tournament = await getTournamentOrThrow(id);
  if (tournament.matchSets.length === 0) {
    throw BadRequestError("Match some players into sets before generating teams");
  }
  // Only the generated teams are (re)filled; hand-built ones keep their
  // players, who are left out of the deal.
  const generated = tournament.teams.flatMap((team, index) => (team.manual ? [] : [index]));
  if (generated.length < 2) {
    throw BadRequestError("Generating needs at least two generated teams");
  }
  const onManualTeam = new Set(tournament.teams.filter((team) => team.manual).flatMap((team) => team.playerIds));
  const rosters = new Map<number, bigint[]>(generated.map((index) => [index, []]));
  const rosterOf = (index: number) => rosters.get(index)!;
  for (const set of tournament.matchSets) {
    const playerIds = set.playerIds.filter((playerId) => !onManualTeam.has(playerId));
    const targets = shuffle(generated)
      .sort((a, b) => rosterOf(a).length - rosterOf(b).length)
      .slice(0, playerIds.length);
    shuffle(playerIds).forEach((playerId, index) => rosterOf(targets[index]).push(playerId));
  }
  return saveTournament(tournament, {
    teams: tournament.teams.map((team, index) => (team.manual ? team : withRoster(team, rosterOf(index)))),
    generatedAt: new Date(),
  });
}

export type TeamRoles = { captainId?: bigint | null; viceCaptainId?: bigint | null; keeperId?: bigint | null };

// The roles that still apply to this roster (anyone off it is cleared).
export function rolesWithin(roles: TeamRoles, playerIds: bigint[]) {
  const keep = (id: bigint | null | undefined) => (id != null && playerIds.includes(id) ? id : null);
  return { captainId: keep(roles.captainId), viceCaptainId: keep(roles.viceCaptainId), keeperId: keep(roles.keeperId) };
}

// Captain, vice-captain and keeper must be on the side; the keeper may also
// lead, but the captain and vice-captain are different players.
export function assertRoles(roles: TeamRoles, playerIds: bigint[]) {
  for (const playerId of [roles.captainId, roles.viceCaptainId, roles.keeperId]) {
    if (playerId != null && !playerIds.includes(playerId)) {
      throw BadRequestError("Captain, vice-captain and keeper must be on the team");
    }
  }
  if (roles.captainId != null && roles.captainId === roles.viceCaptainId) {
    throw BadRequestError("The captain and vice-captain must be different players");
  }
}

// A team with a new roster: its captain / vice-captain / keeper stay only if
// they're still on it.
function withRoster(team: { name: string; manual?: boolean | null } & TeamRoles, playerIds: bigint[]) {
  return { name: team.name, playerIds, ...rolesWithin(team, playerIds), ...(team.manual ? { manual: true } : {}) };
}

function findTeamIndex(teams: { playerIds: bigint[] }[], playerId: bigint) {
  const index = teams.findIndex((team) => team.playerIds.includes(playerId));
  if (index === -1) {
    throw BadRequestError("That player isn't on any team");
  }
  return index;
}

// Trades two players on different teams, each taking the other's place.
export async function swapPlayers(id: bigint, playerA: bigint, playerB: bigint) {
  const tournament = await getTournamentOrThrow(id);
  const teamA = findTeamIndex(tournament.teams, playerA);
  const teamB = findTeamIndex(tournament.teams, playerB);
  if (teamA === teamB) {
    throw BadRequestError("Both players are already on the same team");
  }
  const teams = tournament.teams.map((team) =>
    withRoster(
      team,
      team.playerIds.map((playerId) => (playerId === playerA ? playerB : playerId === playerB ? playerA : playerId)),
    ),
  );
  return saveTournament(tournament, { teams });
}

// Moves one player to another team without a swap — for evening out
// numbers when the player count doesn't divide by the team count.
export async function movePlayer(id: bigint, playerId: bigint, toTeamIndex: number) {
  const tournament = await getTournamentOrThrow(id);
  const fromTeamIndex = findTeamIndex(tournament.teams, playerId);
  if (toTeamIndex < 0 || toTeamIndex >= tournament.teams.length) {
    throw BadRequestError("No such team");
  }
  if (fromTeamIndex === toTeamIndex) {
    throw BadRequestError("The player is already on that team");
  }
  const teams = tournament.teams.map((team, index) =>
    withRoster(
      team,
      index === fromTeamIndex
        ? team.playerIds.filter((other) => other !== playerId)
        : index === toTeamIndex
          ? [...team.playerIds, playerId]
          : team.playerIds,
    ),
  );
  return saveTournament(tournament, { teams });
}

// ===== Tournament teams =====
// Teams are added on the Teams tab: blank ones for generating, built by hand,
// or copied from another tournament. A match refers to its teams by index,
// so new teams are appended, and removing one shifts later matches up.

export const MAX_TEAMS = 16;

// Roles left out keep the team's current ones (cleared if they leave it).
export interface CricketTeamInput extends TeamRoles {
  name: string;
  playerIds: bigint[];
  // Built by hand; left out on an edit keeps the team's current value.
  manual?: boolean | null;
}

// The stored team for this input, on top of the existing one if any.
function teamFrom(input: CricketTeamInput, existing?: TeamRoles & { manual?: boolean | null }) {
  const playerIds = [...new Set(input.playerIds)];
  const pick = (key: keyof TeamRoles) => (input[key] !== undefined ? input[key] : existing?.[key]);
  const manual = input.manual ?? existing?.manual;
  return {
    name: input.name,
    playerIds,
    ...rolesWithin({ captainId: pick("captainId"), viceCaptainId: pick("viceCaptainId"), keeperId: pick("keeperId") }, playerIds),
    ...(manual ? { manual: true } : {}),
  };
}

const teamKey = (name: string) => name.trim().toLowerCase();

// Names are unique within a tournament (ignoring case), each player is on at
// most one team, and every player exists.
async function checkTeams(teams: CricketTeamInput[]) {
  const names = new Set<string>();
  const seen = new Set<bigint>();
  for (const team of teams) {
    if (names.has(teamKey(team.name))) throw ConflictError(`There's already a team called "${team.name}"`);
    names.add(teamKey(team.name));
    assertRoles(team, team.playerIds);
    for (const playerId of team.playerIds) {
      if (seen.has(playerId)) throw BadRequestError("A player can only be on one team");
      seen.add(playerId);
    }
  }
  const known = await prisma.cricketPlayer.count({ where: { id: { in: [...seen] } } });
  if (known !== seen.size) throw BadRequestError("Some of these players no longer exist");
}

// Everyone on a team is also in the squad.
const squadWith = (squad: bigint[], teams: CricketTeamInput[]) => [
  ...new Set([...squad, ...teams.flatMap((team) => team.playerIds)]),
];

export async function addTeams(id: bigint, input: CricketTeamInput[]) {
  const tournament = await getTournamentOrThrow(id);
  const teams = [
    ...tournament.teams,
    ...input.map((team) => teamFrom(team)),
  ];
  if (teams.length > MAX_TEAMS) throw BadRequestError(`A tournament can have at most ${MAX_TEAMS} teams`);
  await checkTeams(teams);
  return saveTournament(tournament, { teams, playerIds: squadWith(tournament.playerIds, teams) });
}

// Renames a team and/or sets its players (leaders who leave it are
// cleared). Matches keep their own copy of the team's name, so those follow
// the rename.
export async function updateTeam(id: bigint, index: number, input: CricketTeamInput) {
  const tournament = await getTournamentOrThrow(id);
  if (index >= tournament.teams.length) throw NotFoundError("Team not found");
  const teams = tournament.teams.map((team, i) =>
    i === index ? teamFrom(input, team) : team,
  );
  await checkTeams(teams);
  const updated = await saveTournament(tournament, { teams, playerIds: squadWith(tournament.playerIds, teams) });
  if (tournament.teams[index].name !== input.name) {
    const matches = await prisma.cricketMatch.findMany({ where: { tournamentId: id } });
    for (const match of matches.filter((m) => m.teams.some((team) => team.teamIndex === index))) {
      await prisma.cricketMatch.update({
        where: { id: match.id },
        data: { teams: match.teams.map((team) => (team.teamIndex === index ? { ...team, name: input.name } : team)) },
      });
    }
  }
  return updated;
}

// The team's captain may add players to it (as can the tournament's
// organisers and super admins).
export async function teamForManager(id: bigint, index: number, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  const tournament = await getTournamentOrThrow(id);
  const team = tournament.teams[index];
  if (!team) throw NotFoundError("Team not found");
  if (!(await canManageTournament(id, viewer))) {
    const me = await findMyPlayer(viewer.adminId);
    if (!me || team.captainId !== me.id) throw ForbiddenError("Only the team's captain can add players");
  }
  return { tournament, team };
}

// The player with this mobile, for the captain's "Add players" sheet (null if
// it's a new number).
export async function lookupTeamPlayer(
  id: bigint,
  index: number,
  mobile: string,
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  await teamForManager(id, index, viewer);
  const player = await prisma.cricketPlayer.findFirst({ where: { mobile } });
  return player && { id: player.id, name: player.name, role: player.role, photoUrl: player.photoUrl, mobile };
}

// A player to add to a team: a mobile number (with a name when it's a new
// one), or a known player picked by id (their QR code).
export type TeamPlayerRow = { mobile: string; name?: string } | { playerId: bigint };

// The rows' players that already exist, and the new numbers to create —
// checked, but nothing written yet.
export async function playersForRows(rows: TeamPlayerRow[]) {
  const mobiles = [...new Map(rows.flatMap((row) => ("mobile" in row ? [[row.mobile, row] as const] : []))).values()];
  const ids = [...new Set(rows.flatMap((row) => ("playerId" in row ? [row.playerId] : [])))];
  const existing = await prisma.cricketPlayer.findMany({
    where: { OR: [{ mobile: { in: mobiles.map((row) => row.mobile) } }, { id: { in: ids } }] },
  });
  if (ids.some((id) => !existing.some((player) => player.id === id))) throw NotFoundError("Player not found");
  const fresh = mobiles.filter((row) => !existing.some((player) => player.mobile === row.mobile));
  if (fresh.some((row) => !row.name)) throw BadRequestError("Enter a name for each new player");
  return { existing, fresh };
}

export async function createPlayersFor(fresh: { mobile: string; name?: string }[]) {
  const created = [];
  for (const row of fresh) {
    created.push(await prisma.cricketPlayer.create({ data: { name: row.name!, mobile: row.mobile } }));
  }
  return created;
}

// Adds players to a team: a known number (or player) joins as is, a new
// number (which needs a name) is created first. Everyone is checked before
// anything is created, so a bad row adds no one.
export async function addTeamPlayers(
  id: bigint,
  index: number,
  rows: TeamPlayerRow[],
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  const { tournament } = await teamForManager(id, index, viewer);
  return addToTournamentTeam(tournament, index, rows);
}

// No check of who's asking: the captain's sheet above, or a player
// joining through the team's link (cricket-invite.service.ts).
export async function addToTournamentTeam(tournament: Tournament, index: number, rows: TeamPlayerRow[]) {
  const team = tournament.teams[index];
  const { existing, fresh } = await playersForRows(rows);
  for (const player of existing) {
    const onTeam = tournament.teams.findIndex((t) => t.playerIds.includes(player.id));
    if (onTeam === index) throw ConflictError(`${player.name} is already in ${team.name}`);
    if (onTeam !== -1) throw ConflictError(`${player.name} is on ${tournament.teams[onTeam].name}`);
  }
  if (team.playerIds.length + existing.length + fresh.length > 100) {
    throw BadRequestError("A team can have at most 100 players");
  }
  const created = await createPlayersFor(fresh);
  const playerIds = [...team.playerIds, ...existing.map((p) => p.id), ...created.map((p) => p.id)];
  const teams = tournament.teams.map((t, i) => (i === index ? { ...t, playerIds } : t));
  return saveTournament(tournament, { teams, playerIds: [...new Set([...tournament.playerIds, ...playerIds])] });
}

export interface CricketTeamRolesInput {
  captainId: bigint | null;
  viceCaptainId: bigint | null;
  keeperId: bigint | null;
}

// Picks a team's captain, vice-captain and wicket-keeper from its players.
export async function setTeamRoles(id: bigint, index: number, input: CricketTeamRolesInput) {
  const tournament = await getTournamentOrThrow(id);
  const team = tournament.teams[index];
  if (!team) throw NotFoundError("Team not found");
  assertRoles(input, team.playerIds);
  const teams = tournament.teams.map((t, i) => (i === index ? { ...t, ...input } : t));
  return saveTournament(tournament, { teams });
}

// A team with matches can't go. Later teams move up one, so their matches'
// and follows' indexes do too; matched sets bigger than the new team count
// are dropped.
export async function removeTeam(id: bigint, index: number) {
  const tournament = await getTournamentOrThrow(id);
  if (index >= tournament.teams.length) throw NotFoundError("Team not found");
  const matches = await prisma.cricketMatch.findMany({ where: { tournamentId: id } });
  if (matches.some((match) => match.teams.some((team) => team.teamIndex === index))) {
    throw ConflictError("This team has matches — delete those first");
  }
  // The format refers to teams by index; it's rebuilt for the new line-up.
  if (tournament.format) {
    throw ConflictError("This tournament has a format — remove it on the Standings tab first");
  }
  const teams = tournament.teams.filter((_, i) => i !== index);
  for (const match of matches.filter((m) => m.teams.some((team) => team.teamIndex > index))) {
    await prisma.cricketMatch.update({
      where: { id: match.id },
      data: {
        teams: match.teams.map((team) => (team.teamIndex > index ? { ...team, teamIndex: team.teamIndex - 1 } : team)),
      },
    });
  }
  // One-off sides picked from these teams follow them too; the removed
  // team's sides carry on together as a friendly team of their own.
  const prefix = `t:${id}:`;
  const removedKey = `f:${randomUUID()}`;
  const rekey = (key: string | null) => {
    if (!key?.startsWith(prefix)) return key;
    const keyIndex = Number(key.slice(prefix.length));
    if (keyIndex === index) return removedKey;
    return keyIndex > index ? `${prefix}${keyIndex - 1}` : key;
  };
  const oneOffs = await prisma.cricketMatch.findMany({ where: { tournamentId: null } });
  for (const match of oneOffs.filter((m) => m.teams.some((team) => rekey(team.teamKey) !== team.teamKey))) {
    await prisma.cricketMatch.update({
      where: { id: match.id },
      data: { teams: match.teams.map((team) => ({ ...team, teamKey: rekey(team.teamKey) })) },
    });
  }
  await prisma.cricketFollow.deleteMany({ where: { kind: "team", targetId: id, teamIndex: index } });
  await prisma.cricketFollow.updateMany({
    where: { kind: "team", targetId: id, teamIndex: { gt: index } },
    data: { teamIndex: { decrement: 1 } },
  });
  await prisma.cricketTeamInvite.deleteMany({ where: { tournamentId: id, teamIndex: index } });
  await prisma.cricketTeamInvite.updateMany({
    where: { tournamentId: id, teamIndex: { gt: index } },
    data: { teamIndex: { decrement: 1 } },
  });
  return prisma.cricketTournament.update({
    where: { id },
    data: {
      teams,
      matchSets: tournament.matchSets.filter((set) => set.playerIds.length <= teams.length),
      ...(teams.length === 0 ? { generatedAt: null } : {}),
    },
  });
}

// Which team a match side is (see CricketMatchTeam.teamKey). A tournament
// match's sides are its tournament teams; an older one-off side without a
// key is told apart by its name and who created the match, so two people's
// same-named teams stay separate. The client has the same rule (teamKeyOf).
export function effectiveTeamKey(
  match: { tournamentId: bigint | null; createdById: bigint | null },
  side: { teamIndex: number; name: string; teamKey?: string | null },
) {
  if (match.tournamentId !== null) return `t:${match.tournamentId}:${side.teamIndex}`;
  return side.teamKey ?? `legacy:${match.createdById ?? 0}:${side.name.trim().toLowerCase()}`;
}

// A team's roster by its key: the tournament or saved team's players, plus
// everyone who has played (or is down to play) for it in any match.
export async function listTeamPlayers(key: string) {
  const ids: bigint[] = [];
  const tournamentTeam = /^t:(\d+):(\d+)$/.exec(key);
  if (tournamentTeam) {
    const tournament = await prisma.cricketTournament.findUnique({ where: { id: BigInt(tournamentTeam[1]) } });
    ids.push(...(tournament?.teams[Number(tournamentTeam[2])]?.playerIds ?? []));
  }
  // A saved team's own players come first.
  if (key.startsWith("f:")) {
    const saved = await prisma.cricketSavedTeam.findFirst({ where: { teamKey: key } });
    ids.push(...(saved?.playerIds ?? []));
  }
  // Only the matches that can hold this team are read: its tournament's,
  // or the one-offs whose side carries the key (older nameless keys still
  // need every one-off).
  const matches = await prisma.cricketMatch.findMany({
    where: tournamentTeam
      ? { OR: [{ tournamentId: BigInt(tournamentTeam[1]) }, { teams: { some: { teamKey: key } } }] }
      : key.startsWith("legacy:")
        ? { tournamentId: null }
        : { teams: { some: { teamKey: key } } },
    select: { tournamentId: true, createdById: true, teams: true },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
  });
  for (const match of matches) {
    for (const side of match.teams) {
      if (effectiveTeamKey(match, side) === key) ids.push(...side.playerIds);
    }
  }
  return { playerIds: [...new Set(ids)] };
}

// A friendly (one-off) team has no roster of its own, so its captain adds
// players to its side in every match it hasn't started yet. The side's
// captain, the match's creator or a super admin may; known numbers join as
// is, new ones (which need a name) are created first. Everything is checked
// before anything is written.
export async function addFriendlyTeamPlayers(
  teamName: string,
  rows: TeamPlayerRow[],
  viewer: { adminId: bigint; isSuperAdmin: boolean },
  teamKey?: string,
) {
  // The team is found by its key when the client sends it (two teams can
  // share a name); older clients send the name only.
  const key = teamName.trim().toLowerCase();
  const sideOf = (match: { tournamentId: bigint | null; createdById: bigint | null; teams: { teamIndex: number; name: string; teamKey?: string | null }[] }) =>
    match.teams.findIndex((team) =>
      teamKey ? effectiveTeamKey(match, team) === teamKey : team.name.trim().toLowerCase() === key,
    );
  const upcoming = (
    await prisma.cricketMatch.findMany({ where: { tournamentId: null, status: "scheduled" } })
  ).filter((match) => sideOf(match) !== -1);
  if (upcoming.length === 0) throw BadRequestError(`${teamName} has no upcoming matches to add players to`);

  const me = viewer.isSuperAdmin ? null : await findMyPlayer(viewer.adminId);
  const allowed = upcoming.filter(
    (match) =>
      viewer.isSuperAdmin ||
      match.createdById === viewer.adminId ||
      (me !== null && match.teams[sideOf(match)].captainId === me.id),
  );
  if (allowed.length === 0) throw ForbiddenError("Only the team's captain can add players");

  const { existing, fresh } = await playersForRows(rows);
  for (const player of existing) {
    const clash = allowed.find((match) => match.teams[1 - sideOf(match)].playerIds.includes(player.id));
    if (clash) throw ConflictError(`${player.name} plays for ${clash.teams[1 - sideOf(clash)].name} in an upcoming match`);
  }
  const created = await createPlayersFor(fresh);
  const ids = [...existing.map((p) => p.id), ...created.map((p) => p.id)];
  for (const match of allowed) {
    const side = sideOf(match);
    const teams = match.teams.map((team, i) =>
      i === side ? { ...team, playerIds: [...new Set([...team.playerIds, ...ids])] } : team,
    );
    await prisma.cricketMatch.update({ where: { id: match.id }, data: { teams } });
  }
  return { matches: allowed.length, playerIds: ids };
}
