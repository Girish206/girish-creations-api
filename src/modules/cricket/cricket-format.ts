import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/httpError";
import { rolesWithin } from "./cricket.service";

// A tournament's format: the phases it's played in, in order — a league or
// groups (round-robin), a knockout bracket, or a series between two teams.
// The client works out the tables, who qualifies and the bracket from the
// matches; the server keeps the format consistent and creates its fixtures.

const KNOCKOUT_STAGES = [
  "round-of-16",
  "quarter-final",
  "eliminator",
  "qualifier-1",
  "qualifier-2",
  "semi-final",
  "third-place",
  "final",
] as const;
const FIXTURE_STAGES = ["league", "group", "super-league", ...KNOCKOUT_STAGES] as const;

const code = z.string().trim().min(1).max(12);
const groupName = z.string().trim().min(1).max(20);
const teamIndex = z.number().int().min(0);

// Where a bracket or super-league team comes from: a team picked outright,
// a finishing place in an earlier phase (group null = the phase's only
// group), or the winner / loser of a knockout slot.
const sourceSchema = z.union([
  z.object({ from: z.literal("team"), teamIndex }),
  z.object({ from: z.literal("rank"), phaseId: code, group: groupName.nullable(), rank: z.number().int().min(1).max(16) }),
  z.object({ from: z.enum(["winner", "loser"]), slot: code }),
]);

const groupSchema = z.object({
  name: groupName,
  // Filled in when the phase starts; a later phase's groups start empty and
  // say where their teams come from in seeds.
  teamIndexes: z.array(teamIndex).max(16),
  seeds: z.array(sourceSchema).max(16),
});

const phaseSchema = z.object({
  id: code,
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["round-robin", "knockout", "series"]),
  groups: z.array(groupSchema).max(8),
  // Round-robin: how many times each pair meets; series: its matches.
  legs: z.number().int().min(1).max(7),
  // Round-robin: each team plays just this many (fewer than everyone once),
  // no opponent twice. Null / missing = everyone, `legs` times.
  matchesPerTeam: z.number().int().min(1).max(15).nullish(),
  // Round-robin: how many from each group go through (the table's cut line).
  qualify: z.number().int().min(0).max(16),
  // Super league: results against the other qualifiers from the earlier
  // phase count towards its table.
  carryPoints: z.boolean(),
  slots: z
    .array(z.object({ code, label: z.string().trim().min(1).max(40), stage: z.enum(KNOCKOUT_STAGES), home: sourceSchema, away: sourceSchema }))
    .max(32),
});

export const formatSchema = z.object({
  preset: z.string().trim().min(1).max(40),
  phases: z.array(phaseSchema).min(1).max(6),
  // How the organiser schedules its matches (days of the week, start time,
  // gap, pitches), so later rounds default to the same.
  schedule: z
    .object({
      oneDay: z.boolean(),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      perDay: z.number().int().min(1).max(12),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      minutesBetween: z.number().int().min(10).max(600),
      pitches: z.number().int().min(1).max(4),
    })
    .optional(),
});
export type CricketFormat = z.infer<typeof formatSchema>;
type Phase = CricketFormat["phases"][number];

export const fixtureSchema = z.object({
  phaseId: code,
  teamAIndex: teamIndex,
  teamBIndex: teamIndex,
  scheduledAt: z.coerce.date().nullable(),
  venue: z
    .string()
    .trim()
    .max(150)
    .nullish()
    .transform((venue) => venue || null),
  stage: z.enum(FIXTURE_STAGES),
  group: groupName.nullable(),
  slot: code.nullable(),
});
export type FixtureInput = z.infer<typeof fixtureSchema>;

export const setFormatSchema = z.object({ format: formatSchema, fixtures: z.array(fixtureSchema).max(300) });
// Starts a later phase: its groups (now that the qualifiers are known) and fixtures.
export const addFixturesSchema = z.object({
  phaseId: code,
  groups: z.array(groupSchema).max(8).optional(),
  fixtures: z.array(fixtureSchema).min(1).max(300),
});

function checkFormat(format: CricketFormat, teamCount: number) {
  const phases = new Map<string, Phase>();
  const slots = new Set<string>();
  const checkSource = (source: z.infer<typeof sourceSchema>) => {
    if (source.from === "team") {
      if (source.teamIndex >= teamCount) throw BadRequestError("The format names a team that isn't in the tournament");
    } else if (source.from === "rank") {
      const phase = phases.get(source.phaseId);
      if (!phase) throw BadRequestError("A qualifier comes from a phase that isn't before it");
      if (source.group !== null && !phase.groups.some((group) => group.name === source.group)) {
        throw BadRequestError(`${phase.name} has no group ${source.group}`);
      }
    } else if (!slots.has(source.slot)) {
      throw BadRequestError(`${source.slot} has to be played before the match its ${source.from} goes to`);
    }
  };
  for (const phase of format.phases) {
    if (phases.has(phase.id)) throw BadRequestError("Two phases share an id");
    const seen = new Set<number>();
    const names = new Set<string>();
    for (const group of phase.groups) {
      if (names.has(group.name)) throw BadRequestError(`${phase.name} has two groups called ${group.name}`);
      names.add(group.name);
      for (const index of group.teamIndexes) {
        if (index >= teamCount) throw BadRequestError("The format names a team that isn't in the tournament");
        if (seen.has(index)) throw BadRequestError(`A team is in ${phase.name} twice`);
        seen.add(index);
      }
      group.seeds.forEach(checkSource);
    }
    if (phase.kind === "series" && phase.groups.some((group) => group.teamIndexes.length > 2)) {
      throw BadRequestError("A series is between two teams");
    }
    if (phase.matchesPerTeam) {
      if (phase.kind !== "round-robin" || phase.legs !== 1) {
        throw BadRequestError("A set number of matches per team is only for a league or groups played once");
      }
      for (const group of phase.groups.filter((g) => g.teamIndexes.length > 0)) {
        const n = group.teamIndexes.length;
        if (phase.matchesPerTeam >= n - 1) throw BadRequestError(`Group ${group.name} is too small to play fewer than everyone once`);
        if (n % 2 === 1 && phase.matchesPerTeam % 2 === 1) {
          throw BadRequestError(`With ${n} teams in group ${group.name}, every team can only play an even number of matches`);
        }
      }
    }
    for (const slot of phase.slots) {
      if (slots.has(slot.code)) throw BadRequestError(`Two matches are called ${slot.code}`);
      checkSource(slot.home);
      checkSource(slot.away);
      slots.add(slot.code);
    }
    phases.set(phase.id, phase);
  }
}

// Each fixture has to fit its phase: two teams of the same group, or a
// bracket slot that hasn't got a match yet.
function checkFixtures(format: CricketFormat, fixtures: FixtureInput[], takenSlots: Set<string>) {
  const slots = new Set(takenSlots);
  for (const fixture of fixtures) {
    const phase = format.phases.find((p) => p.id === fixture.phaseId);
    if (!phase) throw BadRequestError("A fixture is for a phase that isn't in the format");
    if (fixture.teamAIndex === fixture.teamBIndex) throw BadRequestError("A team can't play itself");
    if (phase.kind === "knockout") {
      if (!fixture.slot || !phase.slots.some((slot) => slot.code === fixture.slot)) {
        throw BadRequestError(`${phase.name} has no match called ${fixture.slot ?? "that"}`);
      }
    } else {
      const group = phase.groups.find((g) => g.name === fixture.group);
      const inGroup = (index: number) => group?.teamIndexes.includes(index);
      if (!group || !inGroup(fixture.teamAIndex) || !inGroup(fixture.teamBIndex)) {
        throw BadRequestError(`Both teams of a ${phase.name} match have to be in the same group`);
      }
    }
    if (fixture.slot !== null) {
      if (slots.has(fixture.slot)) throw ConflictError(`${fixture.slot} is already scheduled`);
      slots.add(fixture.slot);
    }
  }
}

async function getTournamentOrThrow(id: bigint) {
  const tournament = await prisma.cricketTournament.findUnique({ where: { id } });
  if (!tournament) throw NotFoundError("Tournament not found");
  return tournament;
}

type Tournament = Awaited<ReturnType<typeof getTournamentOrThrow>>;

// The tournament's details (overs, ground, ball...) go on each new match,
// with the teams' rosters as their default XIs, as on a hand-made one.
async function createFixtures(tournament: Tournament, fixtures: FixtureInput[], createdById: bigint) {
  if (fixtures.length === 0) return;
  await prisma.cricketMatch.createMany({
    data: fixtures.map((fixture) => ({
      tournamentId: tournament.id,
      createdById,
      teams: [fixture.teamAIndex, fixture.teamBIndex].map((index) => ({
        teamIndex: index,
        name: tournament.teams[index].name,
        playerIds: tournament.teams[index].playerIds,
        ...rolesWithin(tournament.teams[index], tournament.teams[index].playerIds),
        logoUrl: tournament.teams[index].logoUrl ?? null,
      })),
      overs: tournament.overs ?? 20,
      ballsPerOver: tournament.ballsPerOver,
      bowlerOverLimit: tournament.bowlerOverLimit,
      lastManStands: tournament.lastManStands,
      freeHit: tournament.freeHit,
      scheduledAt: fixture.scheduledAt,
      venue: fixture.venue ?? tournament.ground,
      city: tournament.city,
      matchType: tournament.matchType,
      ballType: tournament.ballType,
      pitchType: tournament.pitchType,
      stage: fixture.stage,
      phaseId: fixture.phaseId,
      group: fixture.group,
      slot: fixture.slot,
      status: "scheduled",
      innings: [],
      scorerIds: [],
    })),
  });
}

// Sets (or replaces) the format and its first fixtures. Until a format match
// has been played, the old format's unplayed fixtures are cleared and
// rebuilt; matches scheduled by hand are left alone.
export async function setFormat(id: bigint, format: CricketFormat, fixtures: FixtureInput[], createdById: bigint) {
  const tournament = await getTournamentOrThrow(id);
  checkFormat(format, tournament.teams.length);
  const matches = (await prisma.cricketMatch.findMany({ where: { tournamentId: id } })).filter((match) => match.phaseId);
  if (matches.some((match) => match.status !== "scheduled")) {
    throw ConflictError("Format matches have already been played, so the format can't be changed");
  }
  checkFixtures(format, fixtures, new Set());
  await prisma.cricketMatch.deleteMany({ where: { id: { in: matches.map((match) => match.id) } } });
  const updated = await prisma.cricketTournament.update({
    where: { id },
    data: { format: format as unknown as Prisma.InputJsonValue },
  });
  await createFixtures(tournament, fixtures, createdById);
  return updated;
}

// Starts the next phase once its teams are known: fills in its groups
// (when given) and schedules its matches or the next bracket slot.
export async function addFixtures(
  id: bigint,
  input: { phaseId: string; groups?: Phase["groups"]; fixtures: FixtureInput[] },
  createdById: bigint,
) {
  const tournament = await getTournamentOrThrow(id);
  if (!tournament.format) throw BadRequestError("Set up the tournament's format first");
  const format = formatSchema.parse(tournament.format);
  const phase = format.phases.find((p) => p.id === input.phaseId);
  if (!phase) throw NotFoundError("Phase not found");
  if (input.fixtures.some((fixture) => fixture.phaseId !== phase.id)) {
    throw BadRequestError("These fixtures are for another phase");
  }
  if (input.groups) {
    // Started already (by another device, say): don't start it twice.
    if (phase.groups.some((group) => group.teamIndexes.length > 0)) {
      throw ConflictError(`${phase.name} has already been scheduled`);
    }
    if (input.groups.map((g) => g.name).join() !== phase.groups.map((g) => g.name).join()) {
      throw BadRequestError(`${phase.name}'s groups have changed — reload and try again`);
    }
    phase.groups = phase.groups.map((group, index) => ({ ...group, teamIndexes: input.groups![index].teamIndexes }));
    checkFormat(format, tournament.teams.length);
  }
  const matches = await prisma.cricketMatch.findMany({ where: { tournamentId: id } });
  checkFixtures(format, input.fixtures, new Set(matches.flatMap((match) => (match.slot ? [match.slot] : []))));
  const updated = input.groups
    ? await prisma.cricketTournament.update({ where: { id }, data: { format: format as unknown as Prisma.InputJsonValue } })
    : tournament;
  await createFixtures(tournament, input.fixtures, createdById);
  return updated;
}

// Clears the format (its unplayed fixtures go with it; played ones stay as
// ordinary matches, no longer tied to a phase — so a new format can be set).
export async function clearFormat(id: bigint) {
  await getTournamentOrThrow(id);
  const matches = (await prisma.cricketMatch.findMany({ where: { tournamentId: id } })).filter((match) => match.phaseId);
  await prisma.cricketMatch.deleteMany({
    where: { id: { in: matches.filter((match) => match.status === "scheduled").map((match) => match.id) } },
  });
  await prisma.cricketMatch.updateMany({
    where: { id: { in: matches.filter((match) => match.status !== "scheduled").map((match) => match.id) } },
    data: { phaseId: null, group: null, slot: null },
  });
  return prisma.cricketTournament.update({ where: { id }, data: { format: null } });
}

