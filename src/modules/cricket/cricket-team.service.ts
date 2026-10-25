import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/httpError";
import { assertRoles, findMyPlayer, rolesWithin, type TeamRoles } from "./cricket.service";

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
async function forManager(id: bigint, viewer: Viewer, { deleting = false } = {}) {
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

export async function getSavedTeam(id: bigint) {
  return getOrThrow(id);
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

// Adds players by mobile: a known number joins as is, a new one (which needs
// a name) is created first. Everyone is checked before anything is written.
export async function addSavedTeamPlayers(id: bigint, rows: { mobile: string; name?: string }[], viewer: Viewer) {
  const team = await forManager(id, viewer);
  const unique = [...new Map(rows.map((row) => [row.mobile, row])).values()];
  const existing = await prisma.cricketPlayer.findMany({ where: { mobile: { in: unique.map((row) => row.mobile) } } });
  const already = existing.find((player) => team.playerIds.includes(player.id));
  if (already) throw ConflictError(`${already.name} is already in ${team.name}`);
  const fresh = unique.filter((row) => !existing.some((player) => player.mobile === row.mobile));
  if (fresh.some((row) => !row.name)) throw BadRequestError("Enter a name for each new player");
  if (team.playerIds.length + unique.length > MAX_PLAYERS) {
    throw BadRequestError(`A team can have at most ${MAX_PLAYERS} players`);
  }
  const created = [];
  for (const row of fresh) {
    created.push(await prisma.cricketPlayer.create({ data: { name: row.name!, mobile: row.mobile } }));
  }
  return prisma.cricketSavedTeam.update({
    where: { id },
    data: { playerIds: [...team.playerIds, ...existing.map((p) => p.id), ...created.map((p) => p.id)] },
  });
}

// Its matches keep their sides, which carry on as a friendly team.
export async function deleteSavedTeam(id: bigint, viewer: Viewer) {
  await forManager(id, viewer, { deleting: true });
  await prisma.cricketSavedTeam.delete({ where: { id } });
}

// The saved team behind a one-off side's key, if it is one.
export async function savedTeamByKey(teamKey: string) {
  return prisma.cricketSavedTeam.findFirst({ where: { teamKey } });
}
