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

async function assertNameFree(name: string, exceptId?: bigint) {
  const clash = await prisma.cricketPlayer.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) {
    throw ConflictError(`A player named "${clash.name}" already exists`);
  }
}

async function assertPlayerMobileFree(mobile: string, exceptId?: bigint) {
  const clash = await prisma.cricketPlayer.findFirst({
    where: { mobile, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (clash) {
    throw ConflictError(`${clash.name} already has this mobile number`);
  }
}

export async function createPlayer(input: CricketPlayerInput) {
  await assertNameFree(input.name);
  await assertPlayerMobileFree(input.mobile);
  return prisma.cricketPlayer.create({ data: input });
}

// Adds a pasted list in one go, skipping anyone whose name or mobile is
// already taken (in the pool or earlier in the list) rather than failing
// the whole batch.
export async function createPlayersBulk(rows: { name: string; mobile: string }[]) {
  const existing = await prisma.cricketPlayer.findMany({ select: { name: true, mobile: true } });
  const names = new Set(existing.map((player) => player.name.toLowerCase()));
  const mobiles = new Set(existing.flatMap((player) => (player.mobile ? [player.mobile] : [])));
  const fresh: { name: string; mobile: string }[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (names.has(row.name.toLowerCase()) || mobiles.has(row.mobile)) {
      skipped.push(row.name);
      continue;
    }
    names.add(row.name.toLowerCase());
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
  await assertNameFree(input.name, id);
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

// ===== The signed-in player =====

export async function findMyPlayer(adminId: bigint) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!account?.mobile) return null;
  return prisma.cricketPlayer.findFirst({ where: { mobile: account.mobile } });
}

// The signed-in user's player record plus the tournaments they're in and
// the matches they've been picked for — enough for "My Stats", "My
// Matches" and "My Tournaments".
export async function getMe(adminId: bigint) {
  const account = await prisma.adminUser.findUnique({ where: { id: adminId } });
  const player = await findMyPlayer(adminId);
  if (!player) {
    return { player: null, accountMobile: account?.mobile ?? null, tournaments: [], matches: [] };
  }
  const [tournaments, matches] = await Promise.all([
    prisma.cricketTournament.findMany({ where: { playerIds: { has: player.id } }, orderBy: { createdAt: "desc" } }),
    prisma.cricketMatch.findMany({
      where: { teams: { some: { playerIds: { has: player.id } } } },
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  return { player, accountMobile: account?.mobile ?? null, tournaments, matches };
}

// A player (not a super admin) may only look at tournaments they're in.
export async function assertCanViewTournament(tournamentId: bigint, viewer: { adminId: bigint; isSuperAdmin: boolean }) {
  if (viewer.isSuperAdmin) return;
  const player = await findMyPlayer(viewer.adminId);
  const tournament = player
    ? await prisma.cricketTournament.findFirst({ where: { id: tournamentId, playerIds: { has: player.id } } })
    : null;
  if (!tournament) {
    throw ForbiddenError("You can only see tournaments you're playing in");
  }
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

export async function createTournament(input: CricketTournamentInput) {
  return prisma.cricketTournament.create({
    data: {
      name: input.name,
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

// Its matches (and uploaded images) go with it.
export async function deleteTournament(id: bigint) {
  const tournament = await getTournamentOrThrow(id);
  await prisma.cricketMatch.deleteMany({ where: { tournamentId: id } });
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
      teams: tournament.teams.map((team, index) => ({ name: team.name, playerIds: rosters[index] })),
      generatedAt: new Date(),
    },
  });
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
  const teams = tournament.teams.map((team) => ({
    name: team.name,
    playerIds: team.playerIds.map((playerId) =>
      playerId === playerA ? playerB : playerId === playerB ? playerA : playerId,
    ),
  }));
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
  const teams = tournament.teams.map((team, index) => ({
    name: team.name,
    playerIds:
      index === fromTeamIndex
        ? team.playerIds.filter((other) => other !== playerId)
        : index === toTeamIndex
          ? [...team.playerIds, playerId]
          : team.playerIds,
  }));
  return prisma.cricketTournament.update({ where: { id }, data: { teams } });
}

// ===== Tournament teams =====
// Teams are added on the Teams tab: blank ones for generating, built by hand,
// or copied from another tournament. A match refers to its teams by index,
// so new teams are appended, and removing one shifts later matches up.

export const MAX_TEAMS = 8;

export interface CricketTeamInput {
  name: string;
  playerIds: bigint[];
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
    ...input.map((team) => ({ name: team.name, playerIds: [...new Set(team.playerIds)] })),
  ];
  if (teams.length > MAX_TEAMS) throw BadRequestError(`A tournament can have at most ${MAX_TEAMS} teams`);
  await checkTeams(teams);
  return prisma.cricketTournament.update({
    where: { id },
    data: { teams, playerIds: squadWith(tournament.playerIds, teams) },
  });
}

// Renames a team and/or sets its players. Matches keep their own copy of the
// team's name, so those follow the rename.
export async function updateTeam(id: bigint, index: number, input: CricketTeamInput) {
  const tournament = await getTournamentOrThrow(id);
  if (index >= tournament.teams.length) throw NotFoundError("Team not found");
  const teams = tournament.teams.map((team, i) =>
    i === index ? { name: input.name, playerIds: [...new Set(input.playerIds)] } : team,
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

// A team with matches can't go. Later teams move up one, so their matches'
// indexes do too; matched sets bigger than the new team count are dropped.
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
  return prisma.cricketTournament.update({
    where: { id },
    data: {
      teams,
      matchSets: tournament.matchSets.filter((set) => set.playerIds.length <= teams.length),
      ...(teams.length === 0 ? { generatedAt: null } : {}),
    },
  });
}
