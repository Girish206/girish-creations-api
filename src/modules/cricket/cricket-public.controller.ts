import type { Request, Response } from "express";
import type { CricketMatch } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { parseId } from "../../utils/parseId";
import { NotFoundError } from "../../utils/httpError";
import { holdUntilChanged } from "./cricket-live";

// Read-only views for shared links, without signing in: a match or a
// tournament its organiser made public (isPublic), with just enough about
// its players (names, photos, roles — never mobiles) to show the scorecard.
// Anything not public answers "not found", same as a missing one.

const publicPlayers = async (ids: bigint[]) =>
  prisma.cricketPlayer.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, role: true, battingStyle: true, bowlingStyle: true, photoUrl: true },
  });

const tournamentCard = (t: { id: bigint; name: string; logoUrl: string | null; isPublic: boolean | null }) => ({
  id: t.id,
  name: t.name,
  logoUrl: t.logoUrl,
  isPublic: Boolean(t.isPublic),
});

async function publicMatchOrThrow(id: bigint) {
  const match = await prisma.cricketMatch.findUnique({ where: { id } });
  const tournament = match?.tournamentId
    ? await prisma.cricketTournament.findUnique({ where: { id: match.tournamentId } })
    : null;
  if (!match || !(match.isPublic || tournament?.isPublic)) throw NotFoundError("Match not found");
  return { match, tournament };
}

// The match without who's scoring it.
const shareable = (match: CricketMatch) => ({ ...match, scoringById: null, scoringByName: null, scorerIds: [], createdById: null });

export async function publicMatchHandler(req: Request, res: Response) {
  const { match, tournament } = await publicMatchOrThrow(parseId(req.params.id));
  res.json({
    data: {
      match: shareable(match),
      tournament: tournament && tournamentCard(tournament),
      players: await publicPlayers(match.teams.flatMap((team) => team.playerIds)),
    },
  });
}

// Like the signed-in /live: held open until the match changes, then only
// the balls the page doesn't have yet (see matchLiveHandler). Never cached:
// a cached "nothing new" would send the page straight back for another.
export async function publicMatchLiveHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  res.set("Cache-Control", "no-store");
  if (!(await holdUntilChanged(req, res, id))) return;
  const { match } = await publicMatchOrThrow(id);
  const known = String(req.query.known ?? "")
    .split(",")
    .map((n) => Number(n) || 0);
  const innings = match.innings.map((inn, i) => {
    const fromBall = Math.max(0, Math.min(known[i] ?? 0, inn.balls.length) - 6);
    return { ...inn, fromBall, balls: inn.balls.slice(fromBall) };
  });
  res.json({ data: { ...shareable(match), innings } });
}

export async function publicTournamentHandler(req: Request, res: Response) {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id: parseId(req.params.id) } });
  if (!tournament?.isPublic) throw NotFoundError("Tournament not found");
  const matches = await prisma.cricketMatch.findMany({
    where: { tournamentId: tournament.id },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
  res.json({
    data: {
      tournament: { ...tournament, organiserMobile: null, organiserEmail: null, scorerIds: [], organiserIds: [], createdById: null },
      matches: matches.map(shareable),
      players: await publicPlayers([...tournament.playerIds, ...matches.flatMap((m) => m.teams.flatMap((t) => t.playerIds))]),
    },
  });
}
