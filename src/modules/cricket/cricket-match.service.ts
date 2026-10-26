import { randomUUID } from "node:crypto";
import type { CricketBall, CricketInnings, CricketMatch, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, HttpError, NotFoundError } from "../../utils/httpError";
import {
  ballsPerOver,
  cantBat,
  FREE_HIT_OUTS,
  INCOMING_OUTS,
  inningsSummary,
  isFreeHitNext,
  isLegal,
  runsRun,
} from "./cricket.scoring";
import { assertRoles, matchAccessOf, rolesWithin, tournamentTeamLogo, type TeamRoles } from "./cricket.service";
import { savedTeamByKey } from "./cricket-team.service";
import { notifyMatch } from "./cricket-push";

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
  // Playing conditions (see CricketMatch); left out keeps them as they are.
  ballsPerOver?: number | null;
  bowlerOverLimit?: number | null;
  lastManStands?: boolean | null;
  freeHit?: boolean | null;
  isPublic?: boolean | null;
  // A live chase's revised target (rain); left out keeps it.
  revisedTarget?: number | null;
}

// Playing conditions are only written when given, so an older client that
// doesn't know them can't clear them.
const given = <T extends object>(values: T) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;

const matchDetails = (input: Omit<CricketMatchInput, "tournamentId">) => ({
  overs: input.overs,
  scheduledAt: input.scheduledAt ?? null,
  venue: input.venue ?? null,
  stage: input.stage ?? null,
  city: input.city ?? null,
  matchType: input.matchType ?? null,
  ballType: input.ballType ?? null,
  pitchType: input.pitchType ?? null,
  ...given({
    ballsPerOver: input.ballsPerOver,
    bowlerOverLimit: input.bowlerOverLimit,
    lastManStands: input.lastManStands,
    freeHit: input.freeHit,
    isPublic: input.isPublic,
  }),
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
  secondFielderId: bigint | null;
  noDelivery: boolean;
  shotX: number | null;
  shotY: number | null;
  shotZone: string | null;
  byeType: string | null;
  outEnd: string | null;
  boundary: boolean | null;
  // Where the scorer's copy was: the innings it's in and how many balls it
  // had. A ball sent twice (a retry after a lost response), or from a stale
  // copy, is refused instead of being recorded again. Left out by older
  // clients.
  inningsIndex: number | null;
  expectedBalls: number | null;
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
    // A side picked from a saved team starts with its players and leaders.
    const saved = await Promise.all(keys.map((key) => (key?.startsWith("f:") ? savedTeamByKey(key) : null)));
    // A side picked from a tournament team takes its logo.
    const logos = await Promise.all(keys.map((key) => (key?.startsWith("t:") ? tournamentTeamLogo(key) : null)));
    const shared = saved[0] && saved[1] ? saved[0].playerIds.filter((id) => saved[1]!.playerIds.includes(id)) : [];
    if (shared.length) throw BadRequestError("These two teams share players — pick another team");
    return [nameA, nameB].map((name, teamIndex) => {
      const team = saved[teamIndex];
      const captainId = captains[teamIndex];
      if (team) {
        const playerIds = captainId !== null && !team.playerIds.includes(captainId) ? [...team.playerIds, captainId] : team.playerIds;
        return {
          teamIndex,
          name,
          teamKey: team.teamKey,
          playerIds,
          captainId: captainId ?? team.captainId,
          viceCaptainId: team.viceCaptainId,
          keeperId: team.keeperId,
          logoUrl: team.logoUrl,
        };
      }
      return {
        teamIndex,
        name,
        teamKey: keys[teamIndex] ?? newTeamKey(),
        playerIds: captainId === null ? [] : [captainId],
        captainId,
        viceCaptainId: null,
        keeperId: null,
        logoUrl: logos[teamIndex],
      };
    });
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
    logoUrl: tournament.teams[teamIndex].logoUrl ?? null,
  }));
}

// A tournament match starts with the tournament's playing conditions,
// unless the form set its own.
export async function createMatch(input: CricketMatchInput, createdById: bigint) {
  const tournament = input.tournamentId
    ? await prisma.cricketTournament.findUnique({ where: { id: input.tournamentId } })
    : null;
  const defaults = tournament
    ? {
        ballsPerOver: tournament.ballsPerOver,
        bowlerOverLimit: tournament.bowlerOverLimit,
        lastManStands: tournament.lastManStands,
        freeHit: tournament.freeHit,
      }
    : {};
  return prisma.cricketMatch.create({
    data: {
      tournamentId: input.tournamentId,
      createdById,
      teams: await matchTeamsFor(input),
      ...defaults,
      ...matchDetails(input),
      innings: [],
    },
  });
}

// Edits a match that hasn't started (its details, and a standalone one's
// names), or a live one's details only — its sides and XIs stay as they are,
// and so does the length of an over.
export async function updateMatch(id: bigint, input: Omit<CricketMatchInput, "tournamentId">) {
  const match = await getMatchOrThrow(id);
  if (match.status === "live") {
    // Cutting the overs (e.g. for rain) can't undo overs already bowled, or
    // end the innings in progress. A finished innings keeps the overs it
    // had, so the second innings can be shortened on its own.
    const perOver = ballsPerOver(match);
    const current = match.innings[match.innings.length - 1];
    const legalBalls = current && !current.closed ? current.balls.filter(isLegal).length : 0;
    if (legalBalls >= input.overs * perOver) {
      throw BadRequestError(`${Math.floor(legalBalls / perOver) + 1} overs at least — some have already been bowled`);
    }
    let revisedTarget = match.revisedTarget;
    if (input.revisedTarget !== undefined) {
      if (match.innings.length < 2 && input.revisedTarget !== null) {
        throw BadRequestError("A revised target is set during the chase");
      }
      if (input.revisedTarget !== null && input.revisedTarget <= inningsSummary(current.balls).runs) {
        throw BadRequestError("The chasing side has already reached that target");
      }
      revisedTarget = input.revisedTarget;
    }
    const { ballsPerOver: _keep, ...details } = matchDetails(input);
    return prisma.cricketMatch.update({
      where: { id },
      data: { ...details, revisedTarget, version: (match.version ?? 0) + 1 },
    });
  }
  if (match.status !== "scheduled") {
    throw BadRequestError("A finished match can't be edited — reopen it first");
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
  closedAt: null,
  balls: [],
});

export async function startMatch(id: bigint, input: StartMatchInput, scorer: Scorer) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "scheduled") {
    throw new HttpError(409, "This match has already started", "ALREADY_STARTED");
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
  const started = await prisma.cricketMatch.update({
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
      version: (match.version ?? 0) + 1,
    },
  });
  await notifyMatch(started, "started");
  return started;
}

// One person scores a live match at a time. Whoever takes the seat keeps it
// while they keep scoring — closing the app doesn't free it — until they
// hand it over or stop. An organiser can take it from them any time, and
// once it's sat idle for SEAT_IDLE_MS (a dead phone) any scorer can.
export interface Scorer {
  adminId: bigint;
  name: string | null;
}

const SEAT_IDLE_MS = 10 * 60_000;

// Takes the scoring seat (or keeps it) if it's free, idle or already the
// scorer's; takeOver (organisers only) takes it from whoever has it. Done
// in one conditional update so two phones can't both get it.
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
          OR: [
            { scoringById: scorer.adminId },
            { scoringById: null },
            { scoringById: { isSet: false } },
            { scoringSeenAt: { lt: new Date(Date.now() - SEAT_IDLE_MS) } },
          ],
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
    throw BadRequestError(`${player.name} hasn't signed in to CricDesk yet, so they can't score`);
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
// A finished match has no seat: changing it (an undo of the last ball) is
// for whoever scored it last, or an organiser.
export async function assertScoringSeat(id: bigint, scorer: Scorer, isOrganiser: () => Promise<boolean>) {
  const match = await getMatchOrThrow(id);
  if (match.status === "live") {
    await claimScoring(id, scorer);
  } else if (match.status === "completed" && match.scoringById !== scorer.adminId && !(await isOrganiser())) {
    throw ConflictError(`Only ${match.scoringByName ?? "whoever scored it"} or an organiser can change a finished match`);
  }
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
  new Set(innings.balls.filter(cantBat).map((ball) => ball.dismissedId));

// Overs (started) a bowler has bowled in the innings.
function oversBowledBy(innings: CricketInnings, bowlerId: bigint, perOver: number) {
  const overs = new Set<number>();
  let legal = 0;
  for (const ball of innings.balls) {
    if (ball.noDelivery) continue;
    if (ball.bowlerId === bowlerId) overs.add(Math.floor(legal / perOver));
    if (isLegal(ball)) legal++;
  }
  return overs.size;
}

// Wickets that end the innings: all but one of the side, or all of them
// when the last batter carries on alone.
const wicketsToEnd = (match: CricketMatch, innings: CricketInnings) =>
  match.teams[innings.battingTeam].playerIds.length - (match.lastManStands ? 0 : 1);

// Saves a scoring change on top of the copy it was made from: if anything
// else changed the match since (another phone, a retried request), nothing
// is written and the scorer is told to catch up.
async function saveMatch(match: CricketMatch, extra: Prisma.CricketMatchUpdateManyMutationInput = {}) {
  const version = match.version ?? 0;
  const { count } = await prisma.cricketMatch.updateMany({
    where: {
      id: match.id,
      OR: version === 0 ? [{ version: 0 }, { version: null }, { version: { isSet: false } }] : [{ version }],
    },
    data: {
      innings: match.innings,
      status: match.status,
      winner: match.winner,
      resultText: match.resultText,
      resultMethod: match.resultMethod,
      version: version + 1,
      ...extra,
    },
  });
  if (count === 0) {
    throw new HttpError(409, "The score changed on another device — showing the latest", "STALE_SCORE");
  }
  return getMatchOrThrow(match.id);
}

// Picks openers, the next batter after a wicket, or the bowler for a new
// over. Fields left undefined stay as they are.
export async function setCurrentPlayers(id: bigint, input: CurrentPlayersInput) {
  const match = await getMatchOrThrow(id);
  const innings = liveInnings(match);
  const perOver = ballsPerOver(match);
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
  if (next.bowlerId !== null && input.bowlerId !== undefined && input.bowlerId !== innings.bowlerId) {
    if (!bowlingXi.includes(next.bowlerId)) throw BadRequestError("That bowler isn't in the fielding side");
    // No bowling two overs in a row (The Hundred's sets of 5 may run on).
    const legal = innings.balls.filter(isLegal);
    const overJustEnded = legal.length > 0 && legal.length % perOver === 0;
    if (match.matchType !== "hundred" && overJustEnded && legal[legal.length - 1].bowlerId === next.bowlerId) {
      throw BadRequestError("The same bowler can't bowl two overs in a row");
    }
    const limit = match.bowlerOverLimit;
    if (limit && oversBowledBy(innings, next.bowlerId, perOver) >= limit) {
      throw BadRequestError(`That bowler has bowled their ${limit} over${limit === 1 ? "" : "s"}`);
    }
  }
  innings.strikerId = next.strikerId;
  innings.nonStrikerId = next.nonStrikerId;
  innings.bowlerId = next.bowlerId;
  return saveMatch(match);
}

// The runs the chasing side needs: first innings + 1, or the target set
// after a rain cut.
const targetOf = (match: CricketMatch) => match.revisedTarget ?? inningsSummary(match.innings[0].balls).runs + 1;

// Works out the result once the second innings is closed.
function completeMatch(match: CricketMatch) {
  const [first, second] = match.innings;
  const target = targetOf(match);
  const chase = inningsSummary(second.balls);
  const chasingSide = match.teams[second.battingTeam];
  const defendingSide = match.teams[first.battingTeam];
  const revised = match.revisedTarget !== null && match.revisedTarget !== undefined ? " (revised target)" : "";
  match.status = "completed";
  match.resultMethod = null;
  if (chase.runs >= target) {
    const wicketsLeft = wicketsToEnd(match, second) - chase.wickets;
    match.winner = second.battingTeam;
    match.resultText = `${chasingSide.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}${revised}`;
  } else if (chase.runs < target - 1) {
    const margin = target - 1 - chase.runs;
    match.winner = first.battingTeam;
    match.resultText = `${defendingSide.name} won by ${margin} run${margin === 1 ? "" : "s"}${revised}`;
  } else {
    match.winner = null;
    match.resultText = "Match tied";
  }
}

function closeOpenInnings(innings: CricketInnings) {
  innings.closed = true;
  innings.closedAt = new Date();
  innings.strikerId = null;
  innings.nonStrikerId = null;
  innings.bowlerId = null;
}

// Closes the current innings; after the first, the other side bats next.
function closeInnings(match: CricketMatch, innings: CricketInnings) {
  closeOpenInnings(innings);
  if (match.innings.length === 1) {
    match.innings.push(newInnings(1 - innings.battingTeam));
  } else {
    completeMatch(match);
  }
}

function isInningsOver(match: CricketMatch, innings: CricketInnings) {
  const summary = inningsSummary(innings.balls);
  const allOut = summary.wickets >= wicketsToEnd(match, innings);
  const oversDone = summary.legalBalls >= match.overs * ballsPerOver(match);
  const chased = match.innings.length === 2 && innings === match.innings[1] && summary.runs >= targetOf(match);
  return allOut || oversDone || chased;
}

// Saves a ball (or event) and, when it finished the match, tells followers.
async function saveScore(match: CricketMatch, wasLive: boolean) {
  const saved = await saveMatch(match);
  if (wasLive && saved.status === "completed") await notifyMatch(saved, "result");
  return saved;
}

export async function addBall(id: bigint, input: BallInput) {
  const match = await getMatchOrThrow(id);
  const innings = liveInnings(match);
  if (
    input.inningsIndex !== null &&
    (input.inningsIndex !== match.innings.length - 1 || input.expectedBalls !== innings.balls.length)
  ) {
    throw new HttpError(409, "The score changed on another device — showing the latest", "STALE_SCORE");
  }
  const perOver = ballsPerOver(match);
  const lastBall = innings.balls[innings.balls.length - 1];

  // Penalty runs: between deliveries, to the side batting; the crease and
  // the over stay as they are.
  if (input.extraType === "penalty") {
    const batterId = innings.strikerId ?? innings.nonStrikerId ?? lastBall?.batterId;
    const bowlerId = innings.bowlerId ?? lastBall?.bowlerId;
    if (!batterId || !bowlerId) throw BadRequestError("Penalty runs come once play has started");
    innings.balls.push({
      ...emptyBall(),
      batterId,
      nonStrikerId: innings.nonStrikerId ?? batterId,
      bowlerId,
      extraType: "penalty",
      extras: input.extras,
      noDelivery: true,
      at: new Date(),
    });
    if (isInningsOver(match, innings)) closeInnings(match, innings);
    return saveScore(match, true);
  }

  // The last batter on their own (last man stands): they always face.
  const alone = match.lastManStands === true && (innings.strikerId === null) !== (innings.nonStrikerId === null);
  if (alone && innings.strikerId === null) {
    innings.strikerId = innings.nonStrikerId;
    innings.nonStrikerId = null;
  }
  const { strikerId, nonStrikerId } = innings;
  // Timed out / absent hurt: the next batter, before they're in — so a
  // crease (or, at an over's end, the bowler) can still be empty.
  const incoming = input.wicketType !== null && INCOMING_OUTS.includes(input.wicketType);
  const bowlerId = innings.bowlerId ?? (incoming ? (lastBall?.bowlerId ?? null) : null);
  if (incoming) {
    if (bowlerId === null) throw BadRequestError("Pick the bowler first");
    if (strikerId !== null && nonStrikerId !== null) throw BadRequestError("Both batters are already in");
    const dismissed = input.dismissedId;
    if (
      dismissed === null ||
      !match.teams[innings.battingTeam].playerIds.includes(dismissed) ||
      outBatters(innings).has(dismissed) ||
      dismissed === strikerId ||
      dismissed === nonStrikerId
    ) {
      throw BadRequestError("Choose a batter yet to come in");
    }
  } else {
    if (strikerId === null || (nonStrikerId === null && !alone) || bowlerId === null) {
      throw BadRequestError("Pick both batters and the bowler first");
    }
    if (input.wicketType) {
      const either = ["run-out", "retired-hurt", "retired", "retired-out", "obstructing-field"].includes(input.wicketType);
      const allowed = either ? [strikerId, nonStrikerId] : [strikerId];
      if (input.dismissedId === null || !allowed.includes(input.dismissedId)) {
        throw BadRequestError(either ? "Choose which batter" : "Only the striker can be out this way");
      }
    }
    // On a free hit only a run-out (and the like) gets a batter out.
    if (
      match.freeHit !== false &&
      !input.noDelivery &&
      input.wicketType &&
      !FREE_HIT_OUTS.includes(input.wicketType) &&
      isFreeHitNext(innings.balls)
    ) {
      throw BadRequestError("It's a free hit — only a run-out can get the batter out");
    }
  }
  const ball: CricketBall = {
    // An incoming batter's dismissal is theirs alone; the crease is as it was.
    batterId: incoming ? input.dismissedId! : strikerId!,
    // Alone at the crease, the batter stands in at the other end too.
    nonStrikerId: incoming ? (strikerId ?? nonStrikerId ?? input.dismissedId!) : (nonStrikerId ?? strikerId!),
    bowlerId: bowlerId!,
    runs: input.runs,
    extraType: input.extraType,
    extras: input.extras,
    wicketType: input.wicketType,
    dismissedId: input.wicketType ? input.dismissedId : null,
    fielderId: input.wicketType ? input.fielderId : null,
    secondFielderId: input.wicketType === "run-out" ? input.secondFielderId : null,
    noDelivery: input.noDelivery || null,
    shotX: input.shotX,
    shotY: input.shotY,
    shotZone: input.shotZone,
    at: new Date(),
    byeType: input.byeType,
    outEnd: input.wicketType === "run-out" ? input.outEnd : null,
    boundary: input.boundary,
  };
  innings.balls.push(ball);

  // Odd runs: the batters changed ends (alone, there's no one to swap with).
  if (runsRun(ball) % 2 === 1 && !alone) {
    [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
  }
  if (ball.dismissedId !== null) {
    if (ball.wicketType === "run-out" && ball.outEnd && !alone) {
      // Run out at a given end: the other batter is at the other end.
      const survivor = ball.dismissedId === strikerId ? nonStrikerId : strikerId;
      innings.strikerId = ball.outEnd === "striker" ? null : survivor;
      innings.nonStrikerId = ball.outEnd === "striker" ? survivor : null;
    } else {
      if (innings.strikerId === ball.dismissedId) innings.strikerId = null;
      if (innings.nonStrikerId === ball.dismissedId) innings.nonStrikerId = null;
    }
  }
  // End of the over: ends swap and a new bowler is needed.
  const legalBalls = innings.balls.filter(isLegal).length;
  if (isLegal(ball) && legalBalls % perOver === 0) {
    if (!alone) [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
    innings.bowlerId = null;
  }
  if (isInningsOver(match, innings)) {
    closeInnings(match, innings);
  }
  return saveScore(match, true);
}

const emptyBall = (): Omit<CricketBall, "batterId" | "nonStrikerId" | "bowlerId"> => ({
  runs: 0,
  extraType: null,
  extras: 0,
  wicketType: null,
  dismissedId: null,
  fielderId: null,
  secondFielderId: null,
  noDelivery: null,
  shotX: null,
  shotY: null,
  shotZone: null,
  at: null,
  byeType: null,
  outEnd: null,
  boundary: null,
});

// Takes back the last ball, stepping back into the first innings (and out
// of a completed result) when needed. Taking back the end of an innings
// (nothing bowled in the next one yet) only reopens it: its last ball stays.
export async function undoBall(id: bigint) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live" && match.status !== "completed") {
    throw BadRequestError("Nothing to undo");
  }
  if (match.resultMethod) {
    throw BadRequestError("This result was entered by hand — reopen the match instead");
  }
  const reopen = (innings: CricketInnings) => {
    innings.closed = false;
    innings.closedAt = null;
    match.status = "live";
    match.winner = null;
    match.resultText = null;
  };
  let innings = match.innings[match.innings.length - 1];
  if (innings && innings.balls.length === 0 && match.innings.length === 2) {
    match.innings.pop();
    reopen(match.innings[0]);
    return saveMatch(match);
  }
  const ball = innings?.balls.pop();
  if (!ball) {
    throw BadRequestError("No balls bowled yet");
  }
  reopen(innings);
  // A timed out / absent hurt left the crease as it was, and penalty runs
  // never moved it; anything else puts back who was in for it.
  if (!(ball.wicketType && INCOMING_OUTS.includes(ball.wicketType)) && ball.extraType !== "penalty") {
    innings.strikerId = ball.batterId;
    innings.nonStrikerId = ball.nonStrikerId === ball.batterId ? null : ball.nonStrikerId;
    innings.bowlerId = ball.bowlerId;
  }
  return saveMatch(match);
}

// Ends the current innings early (e.g. the side declares or runs out of
// batters who can come in). Ending the chase this way is a defeat for the
// chasing side; rain or a forfeit is a result entered by hand instead.
export async function endInnings(id: bigint) {
  const match = await getMatchOrThrow(id);
  closeInnings(match, liveInnings(match));
  return saveScore(match, true);
}

export async function abandonMatch(id: bigint) {
  const match = await getMatchOrThrow(id);
  if (match.status === "completed") {
    throw BadRequestError("This match is already completed");
  }
  match.innings.filter((innings) => !innings.closed).forEach(closeOpenInnings);
  match.status = "abandoned";
  match.winner = null;
  match.resultText = "No result";
  match.resultMethod = null;
  const saved = await saveMatch(match, { scoringById: null, scoringByName: null, scoringSeenAt: null });
  await notifyMatch(saved, "result");
  return saved;
}

export type ResultMethod = "super-over" | "walkover" | "forfeit" | "concede" | "dls" | "bowl-out" | "other";

export interface ResultInput {
  outcome: "win" | "tie" | "no-result";
  winner: number | null;
  method: ResultMethod;
  // How they won, e.g. "by 12 runs" (DLS) — optional.
  margin: string | null;
}

const METHOD_TEXT: Record<ResultMethod, string> = {
  "super-over": " (super over)",
  walkover: " (walkover)",
  forfeit: " (opponent forfeited)",
  concede: " (opponent conceded)",
  dls: " (DLS)",
  "bowl-out": " (bowl-out)",
  other: "",
};

// A result the organiser enters by hand — a super over, a walkover or
// forfeit, rain (DLS or no result) — at any stage of the match. Any
// innings in progress is closed as it stands.
export async function declareResult(id: bigint, input: ResultInput) {
  const match = await getMatchOrThrow(id);
  if (input.outcome === "win" && input.winner === null) throw BadRequestError("Pick the winner");
  const wasLive = match.status === "live";
  match.innings.filter((innings) => !innings.closed).forEach(closeOpenInnings);
  match.resultMethod = input.method;
  if (input.outcome === "win") {
    match.status = "completed";
    match.winner = input.winner;
    const name = match.teams[input.winner!].name;
    match.resultText =
      input.method === "super-over"
        ? `${name} won the super over`
        : `${name} won${input.margin ? ` ${input.margin}` : ""}${METHOD_TEXT[input.method]}`;
  } else if (input.outcome === "tie") {
    match.status = "completed";
    match.winner = null;
    match.resultText = `Match tied${METHOD_TEXT[input.method]}`;
  } else {
    match.status = "abandoned";
    match.winner = null;
    match.resultText = input.margin ? `No result (${input.margin})` : "No result";
  }
  const saved = await saveMatch(match, { scoringById: null, scoringByName: null, scoringSeenAt: null });
  if (wasLive || match.status !== "abandoned") await notifyMatch(saved, "result");
  return saved;
}

// Takes a finished or abandoned match back to where it was: live again on
// its last innings (to undo balls or carry on), or not started if no ball
// was bowled. The one reopening it takes the scoring seat.
export async function reopenMatch(id: bigint, scorer: Scorer) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "completed" && match.status !== "abandoned") {
    throw BadRequestError("Only a finished or abandoned match can be reopened");
  }
  match.winner = null;
  match.resultText = null;
  match.resultMethod = null;
  const last = match.innings[match.innings.length - 1];
  if (!last) {
    match.status = "scheduled";
    return saveMatch(match, { tossWinner: null, tossDecision: null });
  }
  match.status = "live";
  last.closed = false;
  last.closedAt = null;
  return saveMatch(match, { scoringById: scorer.adminId, scoringByName: scorer.name, scoringSeenAt: new Date() });
}

export interface BallEditInput {
  runs?: number;
  fielderId?: bigint | null;
  secondFielderId?: bigint | null;
  wicketType?: string;
  boundary?: boolean | null;
  // Who bowled the over this ball is in (the whole over changes).
  bowlerId?: bigint;
}

// Bowler-credited dismissals can be swapped for one another (caught for
// bowled, say): none of them moves the crease.
const SWAPPABLE_OUTS = ["bowled", "caught", "caught-behind", "lbw", "stumped", "hit-wicket"];

// Corrects an earlier ball without replaying the innings: who fielded, the
// kind of dismissal, its runs (only to a number that leaves the batters at
// the same ends), whether it was a boundary, or the over's bowler. A
// finished match's result is worked out again.
export async function editBall(id: bigint, inningsIndex: number, ballIndex: number, input: BallEditInput) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live" && match.status !== "completed") throw BadRequestError("Only a started match's balls can be corrected");
  const innings = match.innings[inningsIndex];
  const ball = innings?.balls[ballIndex];
  if (!ball) throw NotFoundError("Ball not found");
  const fielding = match.teams[1 - innings.battingTeam].playerIds;
  if (input.runs !== undefined) {
    if (ball.noDelivery) throw BadRequestError("Nothing was bowled then");
    if (input.runs % 2 !== ball.runs % 2) throw BadRequestError("Runs can only change by an even number (the batters stay at their ends)");
    if (ball.extraType !== null && ball.extraType !== "no-ball") throw BadRequestError("No runs off the bat on that ball");
    ball.runs = input.runs;
  }
  for (const key of ["fielderId", "secondFielderId"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!ball.wicketType) throw BadRequestError("That ball wasn't a wicket");
    if (value !== null && !fielding.includes(value)) throw BadRequestError("That fielder isn't in the fielding side");
    ball[key] = value;
  }
  if (input.wicketType !== undefined) {
    if (!ball.wicketType || !SWAPPABLE_OUTS.includes(ball.wicketType) || !SWAPPABLE_OUTS.includes(input.wicketType)) {
      throw BadRequestError("Only a bowled, caught, lbw, stumped or hit-wicket can be changed to another of those");
    }
    if (ball.extraType !== null) throw BadRequestError("That dismissal can't happen off an extra");
    ball.wicketType = input.wicketType;
  }
  if (input.boundary !== undefined) ball.boundary = input.boundary;
  if (input.bowlerId !== undefined) {
    if (!fielding.includes(input.bowlerId)) throw BadRequestError("That bowler isn't in the fielding side");
    const perOver = ballsPerOver(match);
    let legal = 0;
    const overOf = innings.balls.map((b) => {
      const over = Math.floor(legal / perOver);
      if (isLegal(b)) legal++;
      return over;
    });
    innings.balls.forEach((b, i) => {
      if (overOf[i] === overOf[ballIndex] && !b.noDelivery) b.bowlerId = input.bowlerId!;
    });
    if (innings.bowlerId !== null && overOf[ballIndex] === Math.floor(legal / perOver)) innings.bowlerId = input.bowlerId;
  }
  if (match.status === "completed" && !match.resultMethod && match.innings.length === 2) completeMatch(match);
  return saveMatch(match);
}

// Adds a player to a side during a live match — a late arrival, or a
// substitute replacing someone who hasn't batted or bowled yet.
export async function changeSquad(id: bigint, input: { team: number; addId: bigint; replaceId: bigint | null }) {
  const match = await getMatchOrThrow(id);
  if (match.status !== "live") throw BadRequestError("Players are added this way once a match is live");
  const side = match.teams[input.team];
  if (match.teams.some((team) => team.playerIds.includes(input.addId))) {
    throw BadRequestError("That player is already playing in this match");
  }
  if (!(await prisma.cricketPlayer.count({ where: { id: input.addId } }))) throw BadRequestError("Unknown player");
  let playerIds = [...side.playerIds, input.addId];
  if (input.replaceId !== null) {
    const involved = match.innings.some((innings) =>
      innings.balls.some((ball) => [ball.batterId, ball.nonStrikerId, ball.bowlerId, ball.dismissedId].includes(input.replaceId!)) ||
      [innings.strikerId, innings.nonStrikerId, innings.bowlerId].includes(input.replaceId!),
    );
    if (!side.playerIds.includes(input.replaceId)) throw BadRequestError("That player isn't on this side");
    if (involved) throw BadRequestError("Only a player who hasn't batted or bowled yet can be replaced");
    playerIds = playerIds.filter((playerId) => playerId !== input.replaceId);
  }
  match.teams = match.teams.map((team, i) =>
    i === input.team ? { ...team, playerIds, ...rolesWithin(team, playerIds) } : team,
  );
  return saveMatch(match, { teams: match.teams });
}

export async function setPlayerOfMatch(id: bigint, playerId: bigint | null) {
  const match = await getMatchOrThrow(id);
  if (playerId !== null && !match.teams.some((team) => team.playerIds.includes(playerId))) {
    throw BadRequestError("Pick a player who played in this match");
  }
  return prisma.cricketMatch.update({ where: { id }, data: { playerOfMatchId: playerId } });
}
