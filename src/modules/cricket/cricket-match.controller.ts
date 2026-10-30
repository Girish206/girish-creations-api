import type { Request, Response } from "express";
import { z } from "zod";
import * as matchService from "./cricket-match.service";
import { holdUntilChanged } from "./cricket-live";
import { EXTRA_TYPES, NO_DELIVERY_ALLOWED, NO_DELIVERY_ONLY, WICKET_TYPES } from "./cricket.scoring";
import { parseId } from "../../utils/parseId";
import { BadRequestError, ForbiddenError } from "../../utils/httpError";
import {
  assertCanManageTournament,
  assertCanViewMatch,
  assertCanViewTournament,
  matchAccessOf,
  matchViewCheck,
  setMatchScorers,
} from "./cricket.service";
import { BALL_TYPES, MATCH_TYPES, PITCH_TYPES, scorersSchema, viewerOf } from "./cricket.controller";

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
// See CricketMatchTeam.teamKey / effectiveTeamKey.
const teamKey = z
  .string()
  .regex(/^(t:\d+:\d+|f:[0-9a-f-]{36}|legacy:\d+:.{1,60})$/, "Unknown team")
  .nullable();

const matchDetails = {
  // A tournament match picks two of its teams; a standalone one names its
  // own two sides.
  teamAIndex: z.number().int().min(0).optional(),
  teamBIndex: z.number().int().min(0).optional(),
  teamNames: z.tuple([teamName, teamName]).optional(),
  teamKeys: z.tuple([teamKey, teamKey]).optional(),
  overs: z.number().int().min(1).max(100),
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
  // Playing conditions; left out keeps the match's own.
  ballsPerOver: z.number().int().min(4).max(10).nullish(),
  bowlerOverLimit: z.number().int().min(1).max(50).nullish(),
  lastManStands: z.boolean().nullish(),
  freeHit: z.boolean().nullish(),
  isPublic: z.boolean().nullish(),
};

const createMatchSchema = z.object({
  tournamentId: id.nullish().transform((tid) => tid ?? null),
  ...matchDetails,
  // A standalone match's captains (either may be left out); a tournament
  // match takes its teams' own.
  captainIds: z.tuple([id.nullable(), id.nullable()]).optional(),
});
// A live chase can also get a revised target (rain).
const updateMatchSchema = z.object({ ...matchDetails, revisedTarget: z.number().int().min(1).max(2000).nullish() });

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
    extras: z.number().int().min(0).max(10),
    wicketType: z.enum(WICKET_TYPES).nullable(),
    dismissedId: id.nullable(),
    fielderId: id.nullable(),
    // A run-out's second fielder; older clients leave it out.
    secondFielderId: id.nullish().transform((v) => v ?? null),
    // Between deliveries (no ball bowled); older clients leave it out.
    noDelivery: z.boolean().nullish().transform((v) => v ?? false),
    // The shot map: all three together, or none.
    shotX: z.number().min(-1).max(1).nullish().transform((v) => v ?? null),
    shotY: z.number().min(-1).max(1).nullish().transform((v) => v ?? null),
    shotZone: z.string().trim().min(1).max(40).nullish().transform((v) => v ?? null),
    // Runs off a no-ball that weren't hit (extras, not the batter's).
    byeType: z.enum(["bye", "leg-bye"]).nullish().transform((v) => v ?? null),
    // The end a run-out happened at.
    outEnd: z.enum(["striker", "non-striker"]).nullish().transform((v) => v ?? null),
    // A 4 or 6 to the boundary (false = all run).
    boundary: z.boolean().nullish().transform((v) => v ?? null),
    // Where the scorer's copy was (see BallInput); older clients leave it out.
    inningsIndex: z.number().int().min(0).max(1).nullish().transform((v) => v ?? null),
    expectedBalls: z.number().int().min(0).nullish().transform((v) => v ?? null),
  })
  .superRefine((ball, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (ball.extraType === "penalty") {
      if (!ball.noDelivery || ball.runs !== 0 || ball.wicketType || ball.extras < 1) {
        issue("Penalty runs are awarded between deliveries, on their own");
      }
      return;
    }
    if (ball.extraType === null && ball.extras !== 0) issue("Extras need an extra type");
    if ((ball.extraType === "wide" || ball.extraType === "no-ball") && ball.extras < 1) {
      issue("A wide or no-ball is worth at least 1 extra");
    }
    if (ball.extraType !== null && ball.extraType !== "no-ball" && ball.runs !== 0) {
      issue("No runs off the bat on a wide, bye or leg-bye");
    }
    if (ball.byeType !== null && (ball.extraType !== "no-ball" || ball.runs !== 0 || ball.extras < 2)) {
      issue("Byes or leg-byes are only marked on a no-ball's extra runs");
    }
    if (ball.outEnd !== null && ball.wicketType !== "run-out") issue("Only a run-out has an end");
    if (ball.boundary !== null && ![4, 6].includes(ball.runs)) issue("Only a 4 or 6 can be a boundary");
    const bowlerOuts = ["bowled", "caught", "caught-behind", "lbw", "stumped", "hit-wicket"];
    if ((ball.extraType === "bye" || ball.extraType === "leg-bye") && ball.wicketType && ["bowled", "caught", "caught-behind", "lbw"].includes(ball.wicketType)) {
      issue("A batter can't be bowled, caught or lbw off a bye or leg-bye");
    }
    if (ball.wicketType && bowlerOuts.includes(ball.wicketType) && (ball.runs > 0 || (ball.extraType === null && ball.extras > 0))) {
      issue("No runs count on a ball the batter is out bowled, caught, lbw, stumped or hit-wicket");
    }
    const offWide = ["run-out", "stumped", "hit-wicket", "retired-hurt", "obstructing-field"];
    if (ball.extraType === "wide" && ball.wicketType && !offWide.includes(ball.wicketType)) {
      issue("Only a run-out, stumping, hit-wicket, obstructing the field or retiring hurt can happen off a wide");
    }
    if (
      ball.extraType === "no-ball" &&
      ball.wicketType &&
      !["run-out", "retired-hurt", "obstructing-field", "hit-ball-twice"].includes(ball.wicketType)
    ) {
      issue("Only a run-out can happen off a no-ball");
    }
    if (ball.wicketType && NO_DELIVERY_ONLY.includes(ball.wicketType) && !ball.noDelivery) {
      issue("That's recorded between deliveries");
    }
    if (ball.noDelivery) {
      if (!ball.wicketType || !NO_DELIVERY_ALLOWED.includes(ball.wicketType)) issue("Only a retirement, a Mankad or a timed out can be between deliveries");
      if (ball.runs !== 0 || ball.extras !== 0 || ball.extraType !== null) issue("No runs between deliveries");
      if (ball.shotX !== null) issue("No shot between deliveries");
    }
    if (ball.secondFielderId !== null) {
      if (ball.wicketType !== "run-out") issue("Only a run-out has a second fielder");
      else if (ball.fielderId === null || ball.fielderId === ball.secondFielderId) issue("Pick two different fielders");
    }
    if ([ball.shotX, ball.shotY, ball.shotZone].some((v) => v === null) && (ball.shotX ?? ball.shotY ?? ball.shotZone) !== null) {
      issue("A shot needs its position and zone");
    }
  });

const playerOfMatchSchema = z.object({ playerId: id.nullable() });

// One tournament's matches (one the viewer can open), tournamentId=none for
// the standalone ones, or every match. Players get only the matches they
// could open themselves (the leaderboard and lists are built from these).
export async function listMatchesHandler(req: Request, res: Response) {
  const query = req.query.tournamentId;
  const tournamentId = query === "none" ? null : typeof query === "string" ? parseId(query) : undefined;
  const viewer = viewerOf(req);
  if (!viewer.isSuperAdmin && tournamentId) {
    await assertCanViewTournament(tournamentId, viewer);
    res.json({ data: await matchService.listMatches(tournamentId) });
    return;
  }
  const matches = await matchService.listMatches(tournamentId);
  const canView = await matchViewCheck(viewer);
  res.json({ data: matches.filter(canView) });
}

export async function listPlacesHandler(_req: Request, res: Response) {
  res.json({ data: await matchService.listPlaces() });
}

export async function getMatchHandler(req: Request, res: Response) {
  const match = await matchService.getMatch(parseId(req.params.id));
  await assertCanViewMatch(match, viewerOf(req));
  res.json({ data: match });
}

// A live match page asks this every few seconds instead of the whole match:
// everything but the balls it already has. `known` is how many balls of each
// innings it holds ("12,0"); each innings comes back with `fromBall` and only
// the balls from there on. The last over it has is always sent again, so an
// undo (or an undo and a new ball) between two asks still comes through.
// `since` is the match's updatedAt it holds: the ask is held open until the
// match changes, or answered with an empty 204 after a while (cricket-live).
const RESEND_BALLS = 6;
export async function matchLiveHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (!(await holdUntilChanged(req, res, id))) return;
  const match = await matchService.getMatch(id);
  await assertCanViewMatch(match, viewerOf(req));
  const known = String(req.query.known ?? "")
    .split(",")
    .map((n) => Number(n) || 0);
  const innings = match.innings.map((inn, i) => {
    const fromBall = Math.max(0, Math.min(known[i] ?? 0, inn.balls.length) - RESEND_BALLS);
    return { ...inn, fromBall, balls: inn.balls.slice(fromBall) };
  });
  res.json({ data: { ...match, innings } });
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

// The account taking the scoring seat, named so the others know who has it.
export const scorerOf = (req: Request): matchService.Scorer => ({
  adminId: viewerOf(req).adminId,
  name: req.admin!.name,
});

export async function startMatchHandler(req: Request, res: Response) {
  res.json({ data: await matchService.startMatch(parseId(req.params.id), startSchema.parse(req.body), scorerOf(req)) });
}

export const isOrganiser = async (req: Request) =>
  (await matchAccessOf(parseId(req.params.id), viewerOf(req))) === "organise";

// Opening the scorer takes the seat when it's free; takeOver (organisers
// only) takes it from whoever has it.
export async function claimScoringHandler(req: Request, res: Response) {
  const { takeOver } = z.object({ takeOver: z.boolean().optional() }).parse(req.body ?? {});
  if (takeOver && !(await isOrganiser(req))) {
    throw ForbiddenError("Only the match's organiser can take over scoring");
  }
  res.json({ data: await matchService.claimScoring(parseId(req.params.id), scorerOf(req), takeOver) });
}

export async function handOverScoringHandler(req: Request, res: Response) {
  const { playerId } = z.object({ playerId: id }).parse(req.body);
  const matchId = parseId(req.params.id);
  res.json({ data: await matchService.handOverScoring(matchId, scorerOf(req), await isOrganiser(req), playerId) });
}

export async function releaseScoringHandler(req: Request, res: Response) {
  res.json({ data: await matchService.releaseScoring(parseId(req.params.id), viewerOf(req).adminId) });
}

export async function setCurrentPlayersHandler(req: Request, res: Response) {
  const input = currentPlayersSchema.parse(req.body);
  res.json({ data: await matchService.setCurrentPlayers(parseId(req.params.id), input) });
}

export async function addBallHandler(req: Request, res: Response) {
  res.json({ data: await matchService.addBall(parseId(req.params.id), ballSchema.parse(req.body)) });
}

// A result entered by hand (organisers): super over, walkover, rain...
const resultSchema = z
  .object({
    outcome: z.enum(["win", "tie", "no-result"]),
    winner: teamSlot.nullish().transform((v) => v ?? null),
    method: z.enum(["super-over", "walkover", "forfeit", "concede", "dls", "bowl-out", "other"]),
    margin: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => v || null),
  })
  .refine((r) => (r.outcome === "win") === (r.winner !== null), { message: "Pick the winner", path: ["winner"] });

export async function declareResultHandler(req: Request, res: Response) {
  res.json({ data: await matchService.declareResult(parseId(req.params.id), resultSchema.parse(req.body)) });
}

// Rain: the batting side's overs now, or null for no more play.
const interruptionSchema = z.object({ overs: z.number().int().min(1).max(50).nullable() });

export async function interruptionHandler(req: Request, res: Response) {
  const { overs } = interruptionSchema.parse(req.body);
  res.json({ data: await matchService.recordInterruption(parseId(req.params.id), overs) });
}

export async function reopenMatchHandler(req: Request, res: Response) {
  res.json({ data: await matchService.reopenMatch(parseId(req.params.id), scorerOf(req)) });
}

const ballEditSchema = z.object({
  runs: z.number().int().min(0).max(7).optional(),
  fielderId: id.nullable().optional(),
  secondFielderId: id.nullable().optional(),
  wicketType: z.enum(WICKET_TYPES).optional(),
  boundary: z.boolean().nullable().optional(),
  bowlerId: id.optional(),
});

export async function editBallHandler(req: Request, res: Response) {
  const inningsIndex = z.coerce.number().int().min(0).max(1).parse(req.params.innings);
  const ballIndex = z.coerce.number().int().min(0).parse(req.params.ball);
  res.json({
    data: await matchService.editBall(parseId(req.params.id), inningsIndex, ballIndex, ballEditSchema.parse(req.body)),
  });
}

const squadChangeSchema = z.object({ team: teamSlot, addId: id, replaceId: id.nullish().transform((v) => v ?? null) });

export async function changeSquadHandler(req: Request, res: Response) {
  res.json({ data: await matchService.changeSquad(parseId(req.params.id), squadChangeSchema.parse(req.body)) });
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

export async function setMatchScorersHandler(req: Request, res: Response) {
  const { playerIds } = scorersSchema.parse(req.body);
  res.json({ data: await setMatchScorers(parseId(req.params.id), playerIds) });
}

export async function setPlayerOfMatchHandler(req: Request, res: Response) {
  const { playerId } = playerOfMatchSchema.parse(req.body);
  res.json({ data: await matchService.setPlayerOfMatch(parseId(req.params.id), playerId) });
}
