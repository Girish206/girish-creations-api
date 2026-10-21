import { randomUUID } from "node:crypto";
import type { CricketBall, CricketInnings, CricketMatch } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";
import { inningsSummary, isLegal, isWicket, runsRun } from "./cricket.scoring";
import { assertRoles, matchAccessOf, rolesWithin, type TeamRoles } from "./cricket.service";

const newTeamKey = () => `f:${randomUUID()}`;

export interface CricketMatchInput {
  // Null for a standalone match.
  tournamentId: bigint | null;
  // Two of the tournament's teams...
  teamAIndex?: number;
  teamBIndex?: number;
  // ...or, without a tournament, the two sides' names (and, when it's
  // created, their captains).
  teamNames?: [string, string];
  captainIds?: [bigint | null, bigint | null];
  // Which existing team each side is (see CricketMatchTeam.teamKey); null
  // for a new team, which gets a key of its own.
  teamKeys?: [string | null, string | null];
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
  // Each side's captain / vice-captain / keeper for this match; left out =
  // the ones copied from the tournament team (if they're in the XI).
  roles?: [TeamRoles, TeamRoles];
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
  shotX: number | null;
  shotY: number | null;
  shotZone: string | null;
}

// undefined = every match, null = the standalone ones.
export async function listMatches(tournamentId?: bigint | null) {
  return prisma.cricketMatch.findMany({
    where: tournamentId === undefined ? {} : { tournamentId },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
}

// Every ground and city used on a match or tournament, once each (ignoring
// case and spacing), for the venue / city suggestions on the forms.
export async function listPlaces() {
  const [matches, tournaments] = await Promise.all([
    prisma.cricketMatch.findMany({ select: { venue: true, city: true } }),
    prisma.cricketTournament.findMany({ select: { ground: true, city: true } }),
  ]);
  const distinct = (values: (string | null)[]) => {
    const byKey = new Map<string, string>();
    for (const value of values) {
      const trimmed = value?.trim().replace(/\s+/g, " ");
      if (trimmed && !byKey.has(trimmed.toLowerCase())) byKey.set(trimmed.toLowerCase(), trimmed);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  };
  return {
    grounds: distinct([...matches.map((m) => m.venue), ...tournaments.map((t) => t.ground)]),
    cities: distinct([...matches.map((m) => m.city), ...tournaments.map((t) => t.city)]),
  };
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

// Snapshots both tournament teams (name, current roster as the default
// playing XI, and its leaders) onto the match. A standalone match's sides
// start empty; their players are picked when it starts.
async function matchTeamsFor(input: CricketMatchInput) {
  if (input.tournamentId === null) {
    const [nameA, nameB] = input.teamNames ?? [];
    if (!nameA || !nameB) {
      throw BadRequestError("Name both teams");
    }
    if (nameA.toLowerCase() === nameB.toLowerCase()) {
      throw BadRequestError("The two teams need different names");
    }
    // A captain joins their side's squad straight away.
    const captains = input.captainIds ?? [null, null];
    const named = captains.filter((captainId): captainId is bigint => captainId !== null);
    if (named.length === 2 && named[0] === named[1]) {
      throw BadRequestError("One player can't captain both sides");
    }
    if (named.length && (await prisma.cricketPlayer.count({ where: { id: { in: named } } })) !== named.length) {
      throw BadRequestError("That captain is no longer on the player list");
    }
    const keys = input.teamKeys ?? [null, null];
    if (keys[0] !== null && keys[0] === keys[1]) {
      throw BadRequestError("Pick two different teams");
    }
    return [nameA, nameB].map((name, teamIndex) => ({
      teamIndex,
      name,
      teamKey: keys[teamIndex] ?? newTeamKey(),
      playerIds: captains[teamIndex] === null ? [] : [captains[teamIndex]!],
      captainId: captains[teamIndex],
      viceCaptainId: null,
      keeperId: null,
    }));
  }
  const tournament = await prisma.cricketTournament.findUnique({ where: { id: input.tournamentId } });
  if (!tournament) {
    throw NotFoundError("Tournament not found");
  }
  const { teamAIndex, teamBIndex } = input;
  const count = tournament.teams.length;
  if (teamAIndex === undefined || teamBIndex === undefined || teamAIndex === teamBIndex || teamAIndex >= count || teamBIndex >= count) {
    throw BadRequestError("Pick two different teams from the tournament");
  }
  return [teamAIndex, teamBIndex].map((teamIndex) => ({
    teamIndex,
    name: tournament.teams[teamIndex].name,
    playerIds: tournament.teams[teamIndex].playerIds,
    ...rolesWithin(tournament.teams[teamIndex], tournament.teams[teamIndex].playerIds),
  }));
}

export async function createMatch(input: CricketMatchInput, createdById: bigint) {
  return prisma.cricketMatch.create({
    data: {
      tournamentId: input.tournamentId,
      createdById,
      teams: await matchTeamsFor(input),
      ...matchDetails(input),
      innings: [],
    },
  });
}

// Edits a match that hasn't started (its details, and a standalone one's
// names), or a live one's details only — its sides and XIs stay as they are.
export async function updateMatch(id: bigint, input: Omit<CricketMatchInput, "tournamentId">) {
  const match = await getMatchOrThrow(id);
  if (match.status === "live") {
    // Cutting the overs (e.g. for rain) can't undo overs already bowled, or
    // end the innings in progress.
    match.innings.forEach((innings) => {
      const legalBalls = innings.balls.filter(isLegal).length;
      if (legalBalls > input.overs * 6 || (!innings.closed && legalBalls >= input.overs * 6)) {
        throw BadRequestError(`${Math.ceil((legalBalls + 1) / 6)} overs at least — some have already been bowled`);
      }
    });
    return prisma.cricketMatch.update({ where: { id }, data: matchDetails(input) });
  }
  if (match.status !== "scheduled") {
    throw BadRequestError("A finished match can't be edited");
  }
  // A standalone match keeps its sides (and the captains picked for them),
  // taking any new names and teams.
  const teams =
    match.tournamentId === null
      ? match.teams.map((team, i) => ({
          ...team,
          name: input.teamNames?.[i] ?? team.name,
          // Picking another team swaps the key too; a renamed new one keeps its own.
          teamKey: input.teamKeys ? (input.teamKeys[i] ?? team.teamKey ?? newTeamKey()) : team.teamKey,
        }))
      : await matchTeamsFor({ ...input, tournamentId: match.tournamentId });
  if (teams[0].name.toLowerCase() === teams[1].name.toLowerCase()) {
    throw BadRequestError("The two teams need different names");
  }
  return prisma.cricketMatch.update({
    where: { id },
    data: { teams, ...matchDetails(input) },
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

export async function startMatch(id: bigint, input: StartMatchInput, scorer: Scorer) {
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
  const xis = [xiA, xiB];
  input.roles?.forEach((roles, index) => assertRoles(roles, xis[index]));
  const battingFirst = input.tossDecision === "bat" ? input.tossWinner : 1 - input.tossWinner;
  return prisma.cricketMatch.update({
    where: { id },
    data: {
      status: "live",
      // Whoever starts it scores it first.
      scoringById: scorer.adminId,
      scoringByName: scorer.name,
      scoringSeenAt: new Date(),
      tossWinner: input.tossWinner,
      tossDecision: input.tossDecision,
      teams: match.teams.map((team, index) => ({
        ...team,
        playerIds: xis[index],
        ...rolesWithin(input.roles?.[index] ?? team, xis[index]),
      })),
      innings: [newInnings(battingFirst)],
    },
  });
}

// One person scores a live match at a time. Whoever takes the seat keeps it
// — closing the app doesn't free it — until they hand it over or stop
// scoring. Only an organiser can take it from them (e.g. a dead phone).
export interface Scorer {
  adminId: bigint;
  name: string | null;
}

// Takes the scoring seat (or keeps it) if it's free or already the
// scorer's; takeOver (organisers only) takes it from whoever has it. Done in
// one conditional update so two phones can't both get it.
export async function claimScoring(id: bigint, scorer: Scorer, takeOver = false) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live") {
    throw BadRequestError("This match isn't live");
  }
  const seat = { scoringById: scorer.adminId, scoringByName: scorer.name, scoringSeenAt: new Date() };
  const { count } = await prisma.cricketMatch.updateMany({
    where: takeOver
      ? { id }
      : {
          id,
          OR: [{ scoringById: scorer.adminId }, { scoringById: null }, { scoringById: { isSet: false } }],
        },
    data: seat,
  });
  if (count === 0) {
    const holder = await getMatchOrThrow(id);
    throw ConflictError(`${holder.scoringByName ?? "Someone else"} is scoring this match`);
  }
  return getMatchOrThrow(id);
}

// Passes the seat to another player (through the account signed in with
// their mobile), making them one of the match's scorers if they aren't
// already. Only the one scoring — or an organiser — can.
export async function handOverScoring(id: bigint, from: Scorer, fromOrganiser: boolean, playerId: bigint) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live") {
    throw BadRequestError("This match isn't live");
  }
  if (match.scoringById !== from.adminId && !fromOrganiser) {
    throw ConflictError(`${match.scoringByName ?? "Someone else"} is scoring this match`);
  }
  const player = await prisma.cricketPlayer.findUnique({ where: { id: playerId } });
  if (!player) throw NotFoundError("Player not found");
  const account = player.mobile ? await prisma.adminUser.findFirst({ where: { mobile: player.mobile } }) : null;
  if (!account) {
    throw BadRequestError(`${player.name} hasn't signed in to CrickVerse yet, so they can't score`);
  }
  const access = await matchAccessOf(id, { adminId: account.id, isSuperAdmin: account.isSuperAdmin || account.isOwner });
  return prisma.cricketMatch.update({
    where: { id },
    data: {
      scoringById: account.id,
      scoringByName: player.name,
      scoringSeenAt: new Date(),
      ...(access ? {} : { scorerIds: { push: player.id } }),
    },
  });
}

// Stops scoring and leaves the seat free for any of the match's scorers.
export async function releaseScoring(id: bigint, adminId: bigint) {
  await prisma.cricketMatch.updateMany({
    where: { id, scoringById: adminId },
    data: { scoringById: null, scoringByName: null, scoringSeenAt: null },
  });
  return getMatchOrThrow(id);
}

// Every scoring change on a live match needs the seat; making one keeps it.
export async function assertScoringSeat(id: bigint, scorer: Scorer) {
  const match = await getMatchOrThrow(id);
  if (match.status === "live") await claimScoring(id, scorer);
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
    shotX: input.shotX,
    shotY: input.shotY,
    shotZone: input.shotZone,
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
