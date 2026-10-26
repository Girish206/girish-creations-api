import type { Request, Response } from "express";
import type { CricketMatch } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { parseId } from "../../utils/parseId";
import { NotFoundError } from "../../utils/httpError";

// Read-only views for shared links, without signing in: a match or a
// tournament its organiser made public (isPublic), with just enough about
// its players (names, photos, roles — never mobiles) to show the scorecard.
// Anything not public answers "not found", same as a missing one.

const publicPlayers = async (ids: bigint[]) =>
  prisma.cricketPlayer.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, role: true, photoUrl: true },
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

// Like the signed-in /live: only the balls the page doesn't have yet (see
// matchLiveHandler), so watching costs little.
export async function publicMatchLiveHandler(req: Request, res: Response) {
  const { match } = await publicMatchOrThrow(parseId(req.params.id));
  const known = String(req.query.known ?? "")
    .split(",")
    .map((n) => Number(n) || 0);
  const innings = match.innings.map((inn, i) => {
    const fromBall = Math.max(0, Math.min(known[i] ?? 0, inn.balls.length) - 6);
    return { ...inn, fromBall, balls: inn.balls.slice(fromBall) };
  });
  // A few seconds at the edge: everyone watching shares one database read.
  res.set("Cache-Control", "public, max-age=0, s-maxage=3, stale-while-revalidate=5");
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
