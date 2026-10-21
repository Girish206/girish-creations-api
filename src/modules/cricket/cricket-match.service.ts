import type { CricketBall, CricketInnings, CricketMatch } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, NotFoundError } from "../../utils/httpError";
import { inningsSummary, isLegal, isWicket, runsRun } from "./cricket.scoring";

export interface CricketMatchInput {
  tournamentId: bigint;
  teamAIndex: number;
  teamBIndex: number;
  overs: number;
  scheduledAt?: Date | null;
  venue?: string | null;
  stage?: string | null;
  city?: string | null;
  matchType?: string | null;
  ballType?: string | null;
  pitchType?: string | null;
}

const matchDetails = (input: Omit<CricketMatchInput, "tournamentId">) => ({
  overs: input.overs,
  scheduledAt: input.scheduledAt ?? null,
  venue: input.venue ?? null,
  stage: input.stage ?? null,
  city: input.city ?? null,
  matchType: input.matchType ?? null,
  ballType: input.ballType ?? null,
  pitchType: input.pitchType ?? null,
});

export interface StartMatchInput {
  tossWinner: number;
  tossDecision: "bat" | "bowl";
  // Playing XI of teams[0] and teams[1].
  playerIds: [bigint[], bigint[]];
}

export interface CurrentPlayersInput {
  strikerId?: bigint | null;
  nonStrikerId?: bigint | null;
  bowlerId?: bigint | null;
}

export interface BallInput {
  runs: number;
  extraType: string | null;
  extras: number;
  wicketType: string | null;
  dismissedId: bigint | null;
  fielderId: bigint | null;
}

export async function listMatches(tournamentId?: bigint) {
  return prisma.cricketMatch.findMany({
    where: tournamentId ? { tournamentId } : {},
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
}

async function getMatchOrThrow(id: bigint) {
  const match = await prisma.cricketMatch.findUnique({ where: { id } });
  if (!match) {
    throw NotFoundError("Match not found");
  }
  return match;
}

export async function getMatch(id: bigint) {
  return getMatchOrThrow(id);
}

// Snapshots both tournament teams (name + current roster as the default
// playing XI) onto the match.
async function matchTeamsFor(input: CricketMatchInput) {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id: input.tournamentId } });
  if (!tournament) {
    throw NotFoundError("Tournament not found");
  }
  const { teamAIndex, teamBIndex } = input;
  const count = tournament.teams.length;
  if (teamAIndex === teamBIndex || teamAIndex >= count || teamBIndex >= count) {
    throw BadRequestError("Pick two different teams from the tournament");
  }
  return [teamAIndex, teamBIndex].map((teamIndex) => ({
    teamIndex,
    name: tournament.teams[teamIndex].name,
    playerIds: tournament.teams[teamIndex].playerIds,
  }));
}

export async function createMatch(input: CricketMatchInput) {
  return prisma.cricketMatch.create({
    data: {
      tournamentId: input.tournamentId,
      teams: await matchTeamsFor(input),
      ...matchDetails(input),
      innings: [],
    },
  });
}

export async function updateMatch(id: bigint, input: Omit<CricketMatchInput, "tournamentId">) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "scheduled") {
    throw BadRequestError("Only a match that hasn't started can be edited");
  }
  return prisma.cricketMatch.update({
    where: { id },
    data: {
      teams: await matchTeamsFor({ ...input, tournamentId: match.tournamentId }),
      ...matchDetails(input),
    },
  });
}

export async function deleteMatch(id: bigint) {
  await getMatchOrThrow(id);
  await prisma.cricketMatch.delete({ where: { id } });
}

const newInnings = (battingTeam: number): CricketInnings => ({
  battingTeam,
  strikerId: null,
  nonStrikerId: null,
  bowlerId: null,
  closed: false,
  balls: [],
});

export async function startMatch(id: bigint, input: StartMatchInput) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "scheduled") {
    throw BadRequestError("This match has already started");
  }
  const [xiA, xiB] = input.playerIds.map((ids) => [...new Set(ids)]);
  if (xiA.length < 2 || xiB.length < 2) {
    throw BadRequestError("Each side needs at least 2 players");
  }
  if (xiA.some((playerId) => xiB.includes(playerId))) {
    throw BadRequestError("A player can't play for both sides");
  }
  const known = await prisma.cricketPlayer.count({ where: { id: { in: [...xiA, ...xiB] } } });
  if (known !== xiA.length + xiB.length) {
    throw BadRequestError("Some of these players no longer exist");
  }
  const battingFirst = input.tossDecision === "bat" ? input.tossWinner : 1 - input.tossWinner;
  return prisma.cricketMatch.update({
    where: { id },
    data: {
      status: "live",
      tossWinner: input.tossWinner,
      tossDecision: input.tossDecision,
      teams: match.teams.map((team, index) => ({ ...team, playerIds: index === 0 ? xiA : xiB })),
      innings: [newInnings(battingFirst)],
    },
  });
}

function liveInnings(match: CricketMatch) {
  if (match.status !== "live") {
    throw BadRequestError("This match isn't live");
  }
  const innings = match.innings[match.innings.length - 1];
  if (!innings || innings.closed) {
    throw BadRequestError("No innings in progress");
  }
  return innings;
}

const outBatters = (innings: CricketInnings) =>
  new Set(innings.balls.filter(isWicket).map((ball) => ball.dismissedId));

// Picks openers, the next batter after a wicket, or the bowler for a new
// over. Fields left undefined stay as they are.
export async function setCurrentPlayers(id: bigint, input: CurrentPlayersInput) {
  const match = await getMatchOrThrow(id);
  const innings = liveInnings(match);
  const battingXi = match.teams[innings.battingTeam].playerIds;
  const bowlingXi = match.teams[1 - innings.battingTeam].playerIds;
  const out = outBatters(innings);
  const next = {
    strikerId: input.strikerId === undefined ? innings.strikerId : input.strikerId,
    nonStrikerId: input.nonStrikerId === undefined ? innings.nonStrikerId : input.nonStrikerId,
    bowlerId: input.bowlerId === undefined ? innings.bowlerId : input.bowlerId,
  };
  for (const batterId of [next.strikerId, next.nonStrikerId]) {
    if (batterId === null) continue;
    if (!battingXi.includes(batterId)) throw BadRequestError("That batter isn't in the batting side");
    if (out.has(batterId)) throw BadRequestError("That batter is already out");
  }
  if (next.strikerId !== null && next.strikerId === next.nonStrikerId) {
    throw BadRequestError("Striker and non-striker must be different players");
  }
  if (next.bowlerId !== null) {
    if (!bowlingXi.includes(next.bowlerId)) throw BadRequestError("That bowler isn't in the fielding side");
    // No bowling two overs in a row.
    const legal = innings.balls.filter(isLegal);
    const overJustEnded = legal.length > 0 && legal.length % 6 === 0;
    if (input.bowlerId !== undefined && overJustEnded && legal[legal.length - 1].bowlerId === next.bowlerId) {
      throw BadRequestError("The same bowler can't bowl two overs in a row");
    }
  }
  innings.strikerId = next.strikerId;
  innings.nonStrikerId = next.nonStrikerId;
  innings.bowlerId = next.bowlerId;
  return prisma.cricketMatch.update({ where: { id }, data: { innings: match.innings } });
}

// Works out the result once the second innings is closed.
function completeMatch(match: CricketMatch) {
  const [first, second] = match.innings;
  const firstRuns = inningsSummary(first.balls).runs;
  const chase = inningsSummary(second.balls);
  const chasingSide = match.teams[second.battingTeam];
  const defendingSide = match.teams[first.battingTeam];
  match.status = "completed";
  if (chase.runs > firstRuns) {
    const wicketsLeft = chasingSide.playerIds.length - 1 - chase.wickets;
    match.winner = second.battingTeam;
    match.resultText = `${chasingSide.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
  } else if (chase.runs < firstRuns) {
    const margin = firstRuns - chase.runs;
    match.winner = first.battingTeam;
    match.resultText = `${defendingSide.name} won by ${margin} run${margin === 1 ? "" : "s"}`;
  } else {
    match.winner = null;
    match.resultText = "Match tied";
  }
}

// Closes the current innings; after the first, the other side bats next.
function closeInnings(match: CricketMatch, innings: CricketInnings) {
  innings.closed = true;
  innings.strikerId = null;
  innings.nonStrikerId = null;
  innings.bowlerId = null;
  if (match.innings.length === 1) {
    match.innings.push(newInnings(1 - innings.battingTeam));
  } else {
    completeMatch(match);
  }
}

function isInningsOver(match: CricketMatch, innings: CricketInnings) {
  const summary = inningsSummary(innings.balls);
  const allOut = summary.wickets >= match.teams[innings.battingTeam].playerIds.length - 1;
  const oversDone = summary.legalBalls >= match.overs * 6;
  const chased =
    match.innings.length === 2 && innings === match.innings[1] && summary.runs > inningsSummary(match.innings[0].balls).runs;
  return allOut || oversDone || chased;
}

const saveMatch = (match: CricketMatch) =>
  prisma.cricketMatch.update({
    where: { id: match.id },
    data: { innings: match.innings, status: match.status, winner: match.winner, resultText: match.resultText },
  });

export async function addBall(id: bigint, input: BallInput) {
  const match = await getMatchOrThrow(id);
  const innings = liveInnings(match);
  const { strikerId, nonStrikerId, bowlerId } = innings;
  if (strikerId === null || nonStrikerId === null || bowlerId === null) {
    throw BadRequestError("Pick both batters and the bowler first");
  }
  if (input.wicketType) {
    const runOut = input.wicketType === "run-out" || input.wicketType === "retired-hurt";
    const allowed = runOut ? [strikerId, nonStrikerId] : [strikerId];
    if (input.dismissedId === null || !allowed.includes(input.dismissedId)) {
      throw BadRequestError(runOut ? "Choose which batter is out" : "Only the striker can be out this way");
    }
  }
  const ball: CricketBall = {
    batterId: strikerId,
    nonStrikerId,
    bowlerId,
    runs: input.runs,
    extraType: input.extraType,
    extras: input.extras,
    wicketType: input.wicketType,
    dismissedId: input.wicketType ? input.dismissedId : null,
    fielderId: input.wicketType ? input.fielderId : null,
  };
  innings.balls.push(ball);

  // Odd runs: the batters changed ends.
  if (runsRun(ball) % 2 === 1) {
    [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
  }
  if (ball.dismissedId !== null) {
    if (innings.strikerId === ball.dismissedId) innings.strikerId = null;
    if (innings.nonStrikerId === ball.dismissedId) innings.nonStrikerId = null;
  }
  // End of the over: ends swap and a new bowler is needed.
  const legalBalls = innings.balls.filter(isLegal).length;
  if (isLegal(ball) && legalBalls % 6 === 0) {
    [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
    innings.bowlerId = null;
  }
  if (isInningsOver(match, innings)) {
    closeInnings(match, innings);
  }
  return saveMatch(match);
}

// Takes back the last ball, stepping back into the first innings (and out
// of a completed result) when needed.
export async function undoBall(id: bigint) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live" && match.status !== "completed") {
    throw BadRequestError("Nothing to undo");
  }
  let innings = match.innings[match.innings.length - 1];
  if (innings && innings.balls.length === 0 && match.innings.length === 2) {
    match.innings.pop();
    innings = match.innings[0];
  }
  const ball = innings?.balls.pop();
  if (!ball) {
    throw BadRequestError("No balls bowled yet");
  }
  innings.closed = false;
  innings.strikerId = ball.batterId;
  innings.nonStrikerId = ball.nonStrikerId;
  innings.bowlerId = ball.bowlerId;
  match.status = "live";
  match.winner = null;
  match.resultText = null;
  return saveMatch(match);
}

// Ends the current innings early (e.g. the side declares or runs out of
// batters who can come in).
export async function endInnings(id: bigint) {
  const match = await getMatchOrThrow(id);
  closeInnings(match, liveInnings(match));
  return saveMatch(match);
}

export async function abandonMatch(id: bigint) {
  const match = await getMatchOrThrow(id);
  if (match.status === "completed") {
    throw BadRequestError("This match is already completed");
  }
  return prisma.cricketMatch.update({
    where: { id },
    data: { status: "abandoned", winner: null, resultText: "No result" },
  });
}

export async function setPlayerOfMatch(id: bigint, playerId: bigint | null) {
  const match = await getMatchOrThrow(id);
  if (playerId !== null && !match.teams.some((team) => team.playerIds.includes(playerId))) {
    throw BadRequestError("Pick a player who played in this match");
  }
  return prisma.cricketMatch.update({ where: { id }, data: { playerOfMatchId: playerId } });
}
