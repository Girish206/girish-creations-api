import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { assertMobileFree } from "../admin-user/admin-user.service";
import { deleteUploadedFile, uploadFile } from "../../middleware/upload";

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
}

// Anyone can create a player account with their name, mobile number and a
// password. If an organiser already added them (same mobile), the account
// links to that player; otherwise a new player joins the pool. An account
// that exists for this number without a password (a guest) is claimed:
// it gets the password and cricket access.
export async function signUp(input: CricketSignUpInput) {
  const existing = await accountForMobile(input.mobile);
  if (existing && (existing.passwordHash !== null || !existing.isActive)) {
    throw ConflictError("An account with this mobile number already exists. Sign in instead.");
  }
  const player = await prisma.cricketPlayer.findFirst({ where: { mobile: input.mobile } });
  const name = input.name ?? player?.name;
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
  if (!player) {
    await prisma.cricketPlayer.create({ data: { name, mobile: input.mobile } });
  }
  return account;
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
// ones they play in. created* are the ones they organise.
export async function getMe(adminId: bigint) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  const player = await findMyPlayer(adminId);
  const [createdTournaments, createdMatches] = await Promise.all([
    prisma.cricketTournament.findMany({ where: { createdById: adminId }, orderBy: { createdAt: "desc" } }),
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
  };
}

// A player (not a super admin) may only look at tournaments they're in or
// follow (the tournament or one of its teams).
export async function assertCanViewTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return;
  if (await prisma.cricketTournament.count({ where: { id: tournamentId, createdById: viewer.adminId } })) return;
  const player = await findMyPlayer(viewer.adminId);
  const [tournament, follow] = player
    ? await Promise.all([
        prisma.cricketTournament.findFirst({ where: { id: tournamentId, playerIds: { has: player.id } } }),
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
  match: { tournamentId: bigint | null; createdById: bigint | null; teams: { playerIds: bigint[] }[] },
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  if (viewer.isSuperAdmin || match.createdById === viewer.adminId) return;
  const player = await findMyPlayer(viewer.adminId);
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
// admins and the account that created it.
export async function canManageTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return true;
  return (await prisma.cricketTournament.count({ where: { id: tournamentId, createdById: viewer.adminId } })) > 0;
}

export async function assertCanManageTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (!(await canManageTournament(tournamentId, viewer))) {
    throw ForbiddenError("Only the tournament's organiser can change it");
  }
}

// A match (edit, score, delete) is managed by its creator, its tournament's
// creator and super admins.
export async function assertCanManageMatch(matchId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return;
  const match = await prisma.cricketMatch.findUnique({ where: { id: matchId } });
  if (!match) throw NotFoundError("Match not found");
  if (match.createdById === viewer.adminId) return;
  if (match.tournamentId !== null && (await canManageTournament(match.tournamentId, viewer))) return;
  throw ForbiddenError("Only the match's organiser can change it");
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
    select: { name: true },
  });
  if (inUse) {
    throw ConflictError(`This player is part of the "${inUse.name}" tournament — remove them from it first`);
  }
  const playedIn = await prisma.cricketMatch.count({ where: { teams: { some: { playerIds: { has: id } } } } });
  if (playedIn > 0) {
    throw ConflictError("This player has played in matches, so their record can't be deleted");
  }
  await prisma.cricketPlayer.delete({ where: { id } });
  await prisma.cricketFollow.deleteMany({ where: { OR: [{ followerId: id }, { kind: "player", targetId: id }] } });
  await deleteUploadedFile(existing.photoUrl);
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
}

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

export async function listTournaments() {
  return prisma.cricketTournament.findMany({ orderBy: { createdAt: "desc" } });
}

async function getTournamentOrThrow(id: bigint) {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id } });
  if (!tournament) {
    throw NotFoundError("Tournament not found");
  }
  return tournament;
}

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
    },
  });
}

// Teams aren't touched here — see the team functions below.
export async function updateTournament(id: bigint, input: CricketTournamentInput) {
  await getTournamentOrThrow(id);
  return prisma.cricketTournament.update({
    where: { id },
    data: { name: input.name, ...tournamentDetails(input) },
  });
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

// Its matches, follows (and uploaded images) go with it.
export async function deleteTournament(id: bigint) {
  const tournament = await getTournamentOrThrow(id);
  await prisma.cricketMatch.deleteMany({ where: { tournamentId: id } });
  await prisma.cricketFollow.deleteMany({ where: { kind: { in: ["tournament", "team"] }, targetId: id } });
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
  return prisma.cricketTournament.update({
    where: { id },
    data: {
      playerIds: squad,
      matchSets: tournament.matchSets
        .map((set) => ({ playerIds: set.playerIds.filter((playerId) => inSquad.has(playerId)) }))
        .filter((set) => set.playerIds.length > 0),
    },
  });
}

// Replaces the tournament's matched sets. Each set holds 1..teamCount
// distinct squad players, and no player may appear in two sets.
export async function setMatchSets(id: bigint, sets: bigint[][]) {
  const tournament = await getTournamentOrThrow(id);
  const teamCount = tournament.teams.length;
  const inSquad = new Set(tournament.playerIds);
  const seen = new Set<bigint>();
  for (const set of sets) {
    if (set.length > teamCount) {
      throw BadRequestError(`A matched set can hold at most ${teamCount} players (one per team)`);
    }
    for (const playerId of set) {
      if (!inSquad.has(playerId)) {
        throw BadRequestError("Only players in the tournament's squad can be matched");
      }
      if (seen.has(playerId)) {
        throw BadRequestError("A player can only be in one matched set");
      }
      seen.add(playerId);
    }
  }
  return prisma.cricketTournament.update({
    where: { id },
    data: { matchSets: sets.map((playerIds) => ({ playerIds })) },
  });
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
  const rosters: bigint[][] = tournament.teams.map(() => []);
  for (const set of tournament.matchSets) {
    const targets = shuffle(rosters.map((_, index) => index))
      .sort((a, b) => rosters[a].length - rosters[b].length)
      .slice(0, set.playerIds.length);
    shuffle(set.playerIds).forEach((playerId, index) => rosters[targets[index]].push(playerId));
  }
  return prisma.cricketTournament.update({
    where: { id },
    data: {
      teams: tournament.teams.map((team, index) => withRoster(team, rosters[index])),
      generatedAt: new Date(),
    },
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
function withRoster(team: { name: string } & TeamRoles, playerIds: bigint[]) {
  return { name: team.name, playerIds, ...rolesWithin(team, playerIds) };
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
  return prisma.cricketTournament.update({ where: { id }, data: { teams } });
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
  return prisma.cricketTournament.update({ where: { id }, data: { teams } });
}

// ===== Tournament teams =====
// Teams are added on the Teams tab: blank ones for generating, built by hand,
// or copied from another tournament. A match refers to its teams by index,
// so new teams are appended, and removing one shifts later matches up.

export const MAX_TEAMS = 8;

// Roles left out keep the team's current ones (cleared if they leave it).
export interface CricketTeamInput extends TeamRoles {
  name: string;
  playerIds: bigint[];
}

// The stored team for this input, on top of the existing one if any.
function teamFrom(input: CricketTeamInput, existing?: TeamRoles) {
  const playerIds = [...new Set(input.playerIds)];
  const pick = (key: keyof TeamRoles) => (input[key] !== undefined ? input[key] : existing?.[key]);
  return {
    name: input.name,
    playerIds,
    ...rolesWithin({ captainId: pick("captainId"), viceCaptainId: pick("viceCaptainId"), keeperId: pick("keeperId") }, playerIds),
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
  return prisma.cricketTournament.update({
    where: { id },
    data: { teams, playerIds: squadWith(tournament.playerIds, teams) },
  });
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
  const updated = await prisma.cricketTournament.update({
    where: { id },
    data: { teams, playerIds: squadWith(tournament.playerIds, teams) },
  });
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
// creator and super admins).
async function teamForManager(id: bigint, index: number, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  const tournament = await getTournamentOrThrow(id);
  const team = tournament.teams[index];
  if (!team) throw NotFoundError("Team not found");
  if (!viewer.isSuperAdmin && tournament.createdById !== viewer.adminId) {
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

// Adds players to a team by mobile: a known number joins as is, a new one
// (which needs a name) is created first. Everyone is checked before anything
// is created, so a bad row adds no one.
export async function addTeamPlayers(
  id: bigint,
  index: number,
  rows: { mobile: string; name?: string }[],
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  const { tournament, team } = await teamForManager(id, index, viewer);
  const unique = [...new Map(rows.map((row) => [row.mobile, row])).values()];
  const existing = await prisma.cricketPlayer.findMany({ where: { mobile: { in: unique.map((row) => row.mobile) } } });
  for (const player of existing) {
    const onTeam = tournament.teams.findIndex((t) => t.playerIds.includes(player.id));
    if (onTeam === index) throw ConflictError(`${player.name} is already in ${team.name}`);
    if (onTeam !== -1) throw ConflictError(`${player.name} is on ${tournament.teams[onTeam].name}`);
  }
  const fresh = unique.filter((row) => !existing.some((player) => player.mobile === row.mobile));
  if (fresh.some((row) => !row.name)) throw BadRequestError("Enter a name for each new player");
  if (team.playerIds.length + unique.length > 100) throw BadRequestError("A team can have at most 100 players");
  const created = [];
  for (const row of fresh) {
    created.push(await prisma.cricketPlayer.create({ data: { name: row.name!, mobile: row.mobile } }));
  }
  const playerIds = [...team.playerIds, ...existing.map((p) => p.id), ...created.map((p) => p.id)];
  const teams = tournament.teams.map((t, i) => (i === index ? { ...t, playerIds } : t));
  return prisma.cricketTournament.update({
    where: { id },
    data: { teams, playerIds: [...new Set([...tournament.playerIds, ...playerIds])] },
  });
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
  return prisma.cricketTournament.update({ where: { id }, data: { teams } });
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
  const teams = tournament.teams.filter((_, i) => i !== index);
  for (const match of matches.filter((m) => m.teams.some((team) => team.teamIndex > index))) {
    await prisma.cricketMatch.update({
      where: { id: match.id },
      data: {
        teams: match.teams.map((team) => (team.teamIndex > index ? { ...team, teamIndex: team.teamIndex - 1 } : team)),
      },
    });
  }
  await prisma.cricketFollow.deleteMany({ where: { kind: "team", targetId: id, teamIndex: index } });
  await prisma.cricketFollow.updateMany({
    where: { kind: "team", targetId: id, teamIndex: { gt: index } },
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

// A friendly (one-off) team has no roster of its own, so its captain adds
// players to its side in every match it hasn't started yet. The side's
// captain, the match's creator or a super admin may; known numbers join as
// is, new ones (which need a name) are created first. Everything is checked
// before anything is written.
export async function addFriendlyTeamPlayers(
  teamName: string,
  rows: { mobile: string; name?: string }[],
  viewer: { adminId: bigint; isSuperAdmin: boolean },
) {
  const key = teamName.trim().toLowerCase();
  const sideOf = (match: { teams: { name: string }[] }) =>
    match.teams.findIndex((team) => team.name.trim().toLowerCase() === key);
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

  const unique = [...new Map(rows.map((row) => [row.mobile, row])).values()];
  const existing = await prisma.cricketPlayer.findMany({ where: { mobile: { in: unique.map((row) => row.mobile) } } });
  for (const player of existing) {
    const clash = allowed.find((match) => match.teams[1 - sideOf(match)].playerIds.includes(player.id));
    if (clash) throw ConflictError(`${player.name} plays for ${clash.teams[1 - sideOf(clash)].name} in an upcoming match`);
  }
  const fresh = unique.filter((row) => !existing.some((player) => player.mobile === row.mobile));
  if (fresh.some((row) => !row.name)) throw BadRequestError("Enter a name for each new player");

  const created = [];
  for (const row of fresh) {
    created.push(await prisma.cricketPlayer.create({ data: { name: row.name!, mobile: row.mobile } }));
  }
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
