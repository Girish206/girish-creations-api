import type { Request, Response } from "express";
import { z } from "zod";
import * as matchService from "./cricket-match.service";
import { EXTRA_TYPES, WICKET_TYPES } from "./cricket.scoring";
import { parseId } from "../../utils/parseId";
import { BadRequestError } from "../../utils/httpError";
import { assertCanManageTournament, assertCanViewMatch, assertCanViewTournament } from "./cricket.service";
import { BALL_TYPES, MATCH_TYPES, PITCH_TYPES, viewerOf } from "./cricket.controller";

const id = z.coerce.bigint().positive();
// The round a match is played in, as listed on the client.
const MATCH_STAGES = [
  "league",
  "group",
  "super-league",
  "round-of-16",
  "quarter-final",
  "eliminator",
  "qualifier-1",
  "qualifier-2",
  "semi-final",
  "third-place",
  "final",
  "friendly",
] as const;
const teamSlot = z.number().int().min(0).max(1);
const teamName = z.string().trim().min(1).max(60);

const matchDetails = {
  // A tournament match picks two of its teams; a standalone one names its
  // own two sides.
  teamAIndex: z.number().int().min(0).optional(),
  teamBIndex: z.number().int().min(0).optional(),
  teamNames: z.tuple([teamName, teamName]).optional(),
  overs: z.number().int().min(1).max(50),
  scheduledAt: z.coerce.date().nullish(),
  venue: z
    .string()
    .trim()
    .max(150)
    .nullish()
    .transform((venue) => venue || null),
  stage: z.enum(MATCH_STAGES).nullish(),
  city: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((city) => city || null),
  matchType: z.enum(MATCH_TYPES).nullish(),
  ballType: z.enum(BALL_TYPES).nullish(),
  pitchType: z.enum(PITCH_TYPES).nullish(),
};

const createMatchSchema = z.object({
  tournamentId: id.nullish().transform((tid) => tid ?? null),
  ...matchDetails,
  // A standalone match's captains (either may be left out); a tournament
  // match takes its teams' own.
  captainIds: z.tuple([id.nullable(), id.nullable()]).optional(),
});
const updateMatchSchema = z.object(matchDetails);

const sideRoles = z.object({ captainId: id.nullable(), viceCaptainId: id.nullable(), keeperId: id.nullable() });

const startSchema = z.object({
  tossWinner: teamSlot,
  tossDecision: z.enum(["bat", "bowl"]),
  playerIds: z.tuple([z.array(id).max(30), z.array(id).max(30)]),
  roles: z.tuple([sideRoles, sideRoles]).optional(),
});

const currentPlayersSchema = z.object({
  strikerId: id.nullish(),
  nonStrikerId: id.nullish(),
  bowlerId: id.nullish(),
});

// Which dismissals can happen on which deliveries, and which runs are
// possible alongside each kind of extra.
const ballSchema = z
  .object({
    runs: z.number().int().min(0).max(7),
    extraType: z.enum(EXTRA_TYPES).nullable(),
    extras: z.number().int().min(0).max(7),
    wicketType: z.enum(WICKET_TYPES).nullable(),
    dismissedId: id.nullable(),
    fielderId: id.nullable(),
    // The shot map: all three together, or none.
    shotX: z.number().min(-1).max(1).nullish().transform((v) => v ?? null),
    shotY: z.number().min(-1).max(1).nullish().transform((v) => v ?? null),
    shotZone: z.string().trim().min(1).max(40).nullish().transform((v) => v ?? null),
  })
  .superRefine((ball, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (ball.extraType === null && ball.extras !== 0) issue("Extras need an extra type");
    if ((ball.extraType === "wide" || ball.extraType === "no-ball") && ball.extras < 1) {
      issue("A wide or no-ball is worth at least 1 extra");
    }
    if (ball.extraType !== null && ball.extraType !== "no-ball" && ball.runs !== 0) {
      issue("No runs off the bat on a wide, bye or leg-bye");
    }
    const offWide = ["run-out", "stumped", "hit-wicket", "retired-hurt"];
    if (ball.extraType === "wide" && ball.wicketType && !offWide.includes(ball.wicketType)) {
      issue("Only a run-out, stumping or hit-wicket can happen off a wide");
    }
    if (ball.extraType === "no-ball" && ball.wicketType && !["run-out", "retired-hurt"].includes(ball.wicketType)) {
      issue("Only a run-out can happen off a no-ball");
    }
    if ([ball.shotX, ball.shotY, ball.shotZone].some((v) => v === null) && (ball.shotX ?? ball.shotY ?? ball.shotZone) !== null) {
      issue("A shot needs its position and zone");
    }
  });

const playerOfMatchSchema = z.object({ playerId: id.nullable() });

// Players list one tournament's matches at a time (one they're in).
// tournamentId=none lists the standalone matches (super admin only).
export async function listMatchesHandler(req: Request, res: Response) {
  const query = req.query.tournamentId;
  const tournamentId = query === "none" ? null : typeof query === "string" ? parseId(query) : undefined;
  const viewer = viewerOf(req);
  if (!viewer.isSuperAdmin) {
    if (!tournamentId) throw BadRequestError("Choose a tournament");
    await assertCanViewTournament(tournamentId, viewer);
  }
  res.json({ data: await matchService.listMatches(tournamentId) });
}

export async function getMatchHandler(req: Request, res: Response) {
  const match = await matchService.getMatch(parseId(req.params.id));
  await assertCanViewMatch(match, viewerOf(req));
  res.json({ data: match });
}

// Anyone can make a standalone match; one in a tournament needs its organiser.
export async function createMatchHandler(req: Request, res: Response) {
  const input = createMatchSchema.parse(req.body);
  const viewer = viewerOf(req);
  if (input.tournamentId !== null) await assertCanManageTournament(input.tournamentId, viewer);
  res.status(201).json({ data: await matchService.createMatch(input, viewer.adminId) });
}

export async function updateMatchHandler(req: Request, res: Response) {
  res.json({ data: await matchService.updateMatch(parseId(req.params.id), updateMatchSchema.parse(req.body)) });
}

export async function deleteMatchHandler(req: Request, res: Response) {
  await matchService.deleteMatch(parseId(req.params.id));
  res.status(204).send();
}

export async function startMatchHandler(req: Request, res: Response) {
  res.json({ data: await matchService.startMatch(parseId(req.params.id), startSchema.parse(req.body)) });
}

export async function setCurrentPlayersHandler(req: Request, res: Response) {
  const input = currentPlayersSchema.parse(req.body);
  res.json({ data: await matchService.setCurrentPlayers(parseId(req.params.id), input) });
}

export async function addBallHandler(req: Request, res: Response) {
  res.json({ data: await matchService.addBall(parseId(req.params.id), ballSchema.parse(req.body)) });
}

export async function undoBallHandler(req: Request, res: Response) {
  res.json({ data: await matchService.undoBall(parseId(req.params.id)) });
}

export async function endInningsHandler(req: Request, res: Response) {
  res.json({ data: await matchService.endInnings(parseId(req.params.id)) });
}

export async function abandonMatchHandler(req: Request, res: Response) {
  res.json({ data: await matchService.abandonMatch(parseId(req.params.id)) });
}

export async function setPlayerOfMatchHandler(req: Request, res: Response) {
  const { playerId } = playerOfMatchSchema.parse(req.body);
  res.json({ data: await matchService.setPlayerOfMatch(parseId(req.params.id), playerId) });
}
