import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { deleteUploadedFile, uploadFile } from "../../middleware/upload";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import {
  assertRoles,
  createPlayersFor,
  findMyPlayer,
  playersForRows,
  rolesWithin,
  type TeamPlayerRow,
  type TeamRoles,
} from "./cricket.service";

// Saved teams: teams made outside any tournament (see CricketSavedTeam).

type Viewer = { adminId: bigint; isSuperAdmin: boolean };

const MAX_PLAYERS = 100;
const nameKey = (name: string) => name.trim().toLowerCase();

async function getOrThrow(id: bigint) {
  const team = await prisma.cricketSavedTeam.findUnique({ where: { id } });
  if (!team) throw NotFoundError("Team not found");
  return team;
}

// Its creator, its captain and super admins manage it; only the creator
// and super admins may delete it.
export async function forManager(id: bigint, viewer: Viewer, { deleting = false } = {}) {
  const team = await getOrThrow(id);
  if (viewer.isSuperAdmin || team.createdById === viewer.adminId) return team;
  if (!deleting) {
    const me = await findMyPlayer(viewer.adminId);
    if (me && team.captainId === me.id) return team;
  }
  throw ForbiddenError(deleting ? "Only the team's creator can delete it" : "Only the team's creator or captain can change it");
}

// One person can't have two teams of the same name.
async function assertNameFree(name: string, createdById: bigint, exceptId?: bigint) {
  const mine = await prisma.cricketSavedTeam.findMany({ where: { createdById }, select: { id: true, name: true } });
  if (mine.some((team) => team.id !== exceptId && nameKey(team.name) === nameKey(name))) {
    throw ConflictError(`You already have a team called "${name.trim()}"`);
  }
}

export async function createSavedTeam(name: string, viewer: Viewer) {
  await assertNameFree(name, viewer.adminId);
  return prisma.cricketSavedTeam.create({
    data: { teamKey: `f:${randomUUID()}`, name: name.trim(), playerIds: [], createdById: viewer.adminId },
  });
}

// Open to its creator, its players and super admins, to anyone following
// one of its players, and to whoever organised, scored or played a match
// against it.
export async function getSavedTeam(id: bigint, viewer: Viewer) {
  const team = await getOrThrow(id);
  if (viewer.isSuperAdmin || team.createdById === viewer.adminId) return team;
  const me = await findMyPlayer(viewer.adminId);
  if (me && team.playerIds.includes(me.id)) return team;
  const [follow, match] = await Promise.all([
    me && team.playerIds.length
      ? prisma.cricketFollow.findFirst({ where: { followerId: me.id, kind: "player", targetId: { in: team.playerIds } } })
      : null,
    prisma.cricketMatch.findFirst({
      where: {
        teams: { some: { teamKey: team.teamKey } },
        OR: [
          { createdById: viewer.adminId },
          ...(me ? [{ scorerIds: { has: me.id } }, { teams: { some: { playerIds: { has: me.id } } } }] : []),
        ],
      },
      select: { id: true },
    }),
  ]);
  if (follow || match) return team;
  throw ForbiddenError("Follow a player in this team to see it");
}

// The teams someone made or plays for (their My Teams).
export async function listMySavedTeams(adminId: bigint, playerId: bigint | null) {
  return prisma.cricketSavedTeam.findMany({
    where: { OR: [{ createdById: adminId }, ...(playerId !== null ? [{ playerIds: { has: playerId } }] : [])] },
    orderBy: { createdAt: "desc" },
  });
}

// Renames it and/or sets its players (leaders who leave are cleared).
export async function updateSavedTeam(id: bigint, input: { name?: string; playerIds?: bigint[] }, viewer: Viewer) {
  const team = await forManager(id, viewer);
  if (input.name !== undefined) await assertNameFree(input.name, team.createdById, id);
  const playerIds = input.playerIds ? [...new Set(input.playerIds)] : team.playerIds;
  if (input.playerIds && playerIds.some((playerId) => !team.playerIds.includes(playerId))) {
    throw BadRequestError("Add new players by mobile number");
  }
  return prisma.cricketSavedTeam.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      playerIds,
      ...rolesWithin(team, playerIds),
    },
  });
}

export async function setSavedTeamRoles(id: bigint, roles: TeamRoles, viewer: Viewer) {
  const team = await forManager(id, viewer);
  assertRoles(roles, team.playerIds);
  return prisma.cricketSavedTeam.update({
    where: { id },
    data: { captainId: roles.captainId ?? null, viceCaptainId: roles.viceCaptainId ?? null, keeperId: roles.keeperId ?? null },
  });
}

// Adds players by mobile (or a known player by id): a known number joins as
// is, a new one (which needs a name) is created first. Everyone is checked
// before anything is written.
export async function addSavedTeamPlayers(id: bigint, rows: TeamPlayerRow[], viewer: Viewer) {
  return addToSavedTeam(await forManager(id, viewer), rows);
}

type SavedTeam = Awaited<ReturnType<typeof getOrThrow>>;

// No check of who's asking: the manager's sheet above, or a player joining
// through the team's link (cricket-invite.service.ts).
export async function addToSavedTeam(team: SavedTeam, rows: TeamPlayerRow[]) {
  const { existing, fresh } = await playersForRows(rows);
  const already = existing.find((player) => team.playerIds.includes(player.id));
  if (already) throw ConflictError(`${already.name} is already in ${team.name}`);
  if (team.playerIds.length + existing.length + fresh.length > MAX_PLAYERS) {
    throw BadRequestError(`A team can have at most ${MAX_PLAYERS} players`);
  }
  const created = await createPlayersFor(fresh);
  const added = [...existing.map((p) => p.id), ...created.map((p) => p.id)];
  // The team's matches that haven't started get them too (unless they're
  // down to play for the other side there).
  const upcoming = await prisma.cricketMatch.findMany({
    where: { status: "scheduled", teams: { some: { teamKey: team.teamKey } } },
  });
  for (const match of upcoming) {
    const other = match.teams.find((side) => side.teamKey !== team.teamKey);
    const joining = added.filter((playerId) => !other?.playerIds.includes(playerId));
    await prisma.cricketMatch.update({
      where: { id: match.id },
      data: {
        teams: match.teams.map((side) =>
          side.teamKey === team.teamKey ? { ...side, playerIds: [...new Set([...side.playerIds, ...joining])] } : side,
        ),
      },
    });
  }
  return prisma.cricketSavedTeam.update({
    where: { id: team.id },
    data: { playerIds: [...team.playerIds, ...added] },
  });
}

// A new logo replaces the old one (whose file is deleted); null clears it.
export async function setSavedTeamLogo(id: bigint, logo: Express.Multer.File | null, viewer: Viewer) {
  const team = await forManager(id, viewer);
  if (logo && !logo.mimetype.startsWith("image/")) throw BadRequestError("The logo must be an image");
  const updated = await prisma.cricketSavedTeam.update({
    where: { id },
    data: { logoUrl: logo ? await uploadFile(logo) : null },
  });
  await deleteUploadedFile(team.logoUrl);
  return updated;
}

// Its matches keep their sides, which carry on as a friendly team.
export async function deleteSavedTeam(id: bigint, viewer: Viewer) {
  const team = await forManager(id, viewer, { deleting: true });
  await prisma.cricketTeamInvite.deleteMany({ where: { savedTeamId: id } });
  await prisma.cricketSavedTeam.delete({ where: { id } });
  await deleteUploadedFile(team.logoUrl);
}

// The saved team behind a one-off side's key, if it is one.
export async function savedTeamByKey(teamKey: string) {
  return prisma.cricketSavedTeam.findFirst({ where: { teamKey } });
}
