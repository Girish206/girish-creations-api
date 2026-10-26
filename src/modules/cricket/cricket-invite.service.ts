import { randomInt } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { BadRequestError, NotFoundError } from "../../utils/httpError";
import { addToTournamentTeam, findMyPlayer, teamForManager } from "./cricket.service";
import { addToSavedTeam, forManager } from "./cricket-team.service";

// Team join links (see CricketTeamInvite): a team's managers share the link
// (or its QR code), and whoever opens it signed in joins the team.

type Viewer = { adminId: bigint; isSuperAdmin: boolean };

// Which team a link is for: a saved team, or one of a tournament's.
export type InviteTarget = { savedTeamId: bigint } | { tournamentId: bigint; teamIndex: number };

// Ten letters and digits, leaving out ones that look alike (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

// A link works for a week; after that its managers' sheet makes a new one.
const LINK_TTL_MS = 7 * 24 * 60 * 60_000;
const expired = (invite: { expiresAt: Date | null }) => invite.expiresAt !== null && invite.expiresAt.getTime() <= Date.now();

const whereTarget = (target: InviteTarget) =>
  "savedTeamId" in target
    ? { savedTeamId: target.savedTeamId }
    : { tournamentId: target.tournamentId, teamIndex: target.teamIndex };

// The team's link code for its managers (the same people who add its
// players), made the first time it's asked for (or once the last one
// expired). `fresh` replaces it, so the old link stops working.
export async function teamInviteCode(target: InviteTarget, viewer: Viewer, { fresh = false } = {}) {
  if ("savedTeamId" in target) await forManager(target.savedTeamId, viewer);
  else await teamForManager(target.tournamentId, target.teamIndex, viewer);
  const existing = await prisma.cricketTeamInvite.findFirst({ where: whereTarget(target) });
  if (existing && !fresh && !expired(existing)) return { code: existing.code, expiresAt: existing.expiresAt };
  const data = { code: newCode(), expiresAt: new Date(Date.now() + LINK_TTL_MS) };
  const invite = existing
    ? await prisma.cricketTeamInvite.update({ where: { id: existing.id }, data })
    : await prisma.cricketTeamInvite.create({ data: { ...data, ...whereTarget(target) } });
  return { code: invite.code, expiresAt: invite.expiresAt };
}

// The team a link points at (the link itself is the permission to see it).
async function teamOfCode(code: string) {
  const invite = await prisma.cricketTeamInvite.findUnique({ where: { code } });
  const gone = NotFoundError("This link doesn't work any more — ask the team for a new one");
  if (!invite) throw gone;
  if (expired(invite)) throw NotFoundError("This link has expired — ask the team for a new one");
  if (invite.savedTeamId !== null) {
    const team = await prisma.cricketSavedTeam.findUnique({ where: { id: invite.savedTeamId } });
    if (!team) throw gone;
    return { kind: "saved" as const, team };
  }
  const tournament = invite.tournamentId !== null
    ? await prisma.cricketTournament.findUnique({ where: { id: invite.tournamentId } })
    : null;
  const teamIndex = invite.teamIndex ?? -1;
  const team = tournament?.teams[teamIndex];
  if (!tournament || !team) throw gone;
  return { kind: "tournament" as const, team, tournament, teamIndex };
}

// What the join page shows: the team, and whether the viewer is in it.
// Also how a scanned team QR picks a side for a match (teamKey), or copies
// the team into a tournament (name, players and leaders).
export async function invitePreview(code: string, viewer: Viewer) {
  const found = await teamOfCode(code);
  const me = await findMyPlayer(viewer.adminId);
  const common = {
    code,
    name: found.team.name,
    playerIds: found.team.playerIds,
    captainId: found.team.captainId ?? null,
    viceCaptainId: found.team.viceCaptainId ?? null,
    keeperId: found.team.keeperId ?? null,
    joined: me !== null && found.team.playerIds.includes(me.id),
  };
  if (found.kind === "saved") {
    return { ...common, kind: found.kind, savedTeamId: found.team.id, teamKey: found.team.teamKey };
  }
  const otherTeam = me
    ? found.tournament.teams.find((team, i) => i !== found.teamIndex && team.playerIds.includes(me.id))
    : undefined;
  return {
    ...common,
    kind: found.kind,
    tournamentId: found.tournament.id,
    tournamentName: found.tournament.name,
    teamIndex: found.teamIndex,
    teamKey: `t:${found.tournament.id}:${found.teamIndex}`,
    // Already playing for another of the tournament's teams.
    otherTeam: otherTeam?.name ?? null,
  };
}

// The viewer adds themselves to the link's team (already in it is fine).
export async function joinByCode(code: string, viewer: Viewer) {
  const me = await findMyPlayer(viewer.adminId);
  if (!me) throw BadRequestError("Sign in with your mobile number to join a team");
  const found = await teamOfCode(code);
  if (!found.team.playerIds.includes(me.id)) {
    if (found.kind === "saved") await addToSavedTeam(found.team, [{ playerId: me.id }]);
    else await addToTournamentTeam(found.tournament, found.teamIndex, [{ playerId: me.id }]);
  }
  return invitePreview(code, viewer);
}
