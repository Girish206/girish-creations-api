import type { Request, Response } from "express";
import { z } from "zod";
import * as cricketService from "./cricket.service";
import * as formatService from "./cricket-format";
import { parseId } from "../../utils/parseId";
import { mobileSchema } from "../../utils/mobile";
import { isSuperAdmin } from "../../middleware/auth";
import { issueToken } from "../auth/auth.service";
import { BadRequestError, NotFoundError } from "../../utils/httpError";
import { playerQrToken, teamRows } from "./cricket-qr";

// Who's asking: super admins see everything, players only their own.
export const viewerOf = (req: Request) => ({ adminId: BigInt(req.admin!.sub), isSuperAdmin: isSuperAdmin(req.admin) });

const playerId = z.coerce.bigint().positive();
// A tournament's or match's scorers (players), replacing the list.
export const scorersSchema = z.object({ playerIds: z.array(playerId).max(20) });

// Trimmed with inner runs of spaces collapsed ("Ravi  Kumar" → "Ravi Kumar").
const playerName = z.string().transform((name) => name.trim().replace(/\s+/g, " "));

const BATTING_STYLES = ["right-hand", "left-hand"] as const;
const BOWLING_STYLES = [
  "right-arm-fast",
  "right-arm-medium",
  "right-arm-spin",
  "left-arm-fast",
  "left-arm-medium",
  "left-arm-spin",
] as const;

const playerSchema = z.object({
  name: playerName.pipe(z.string().min(1).max(100)),
  role: z.enum(["batter", "bowler", "all-rounder", "wicket-keeper"]).nullish(),
  battingStyle: z.enum(BATTING_STYLES).nullish(),
  bowlingStyle: z.enum(BOWLING_STYLES).nullish(),
  mobile: mobileSchema,
});

const playerStyleSchema = z.object({
  battingStyle: z.enum(BATTING_STYLES).nullish(),
  bowlingStyle: z.enum(BOWLING_STYLES).nullish(),
});

const bulkPlayersSchema = z.object({
  players: z
    .array(z.object({ name: playerName.pipe(z.string().min(1).max(100)), mobile: mobileSchema }))
    .min(1)
    .max(500),
});

const loginSchema = z.object({ password: z.string().min(8).optional() });

// The name can be left out when an organiser already added this mobile
// (setting a password for a team-added player): the player's name is used.
const signUpSchema = z.object({
  name: playerName.pipe(z.string().min(2).max(100)).optional(),
  mobile: mobileSchema,
  password: z.string().min(8).max(100),
  inviteCode: z.string().trim().max(12).optional(),
});

const profileSchema = z
  .object({
    name: playerName.pipe(z.string().min(2).max(100)),
    mobile: mobileSchema,
    role: z.enum(["batter", "bowler", "all-rounder", "wicket-keeper"]).nullish(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).max(100).optional(),
  })
  .refine((p) => !p.newPassword || p.currentPassword, {
    message: "Enter your current password",
    path: ["currentPassword"],
  });

// Blank text comes through as null.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const BALL_TYPES = ["tennis", "leather", "other"] as const;
export const PITCH_TYPES = ["rough", "cement", "turf", "astroturf", "matting"] as const;
export const MATCH_TYPES = ["limited-overs", "box", "pair", "test", "hundred"] as const;
const CATEGORIES = ["open", "corporate", "community", "school", "other", "series", "college", "university"] as const;

const tournamentSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    // Left out keeps them (older clients don't send them).
    seriesName: optionalText(100).optional(),
    season: optionalText(40).optional(),
    city: optionalText(100),
    ground: optionalText(150),
    organiserName: optionalText(100),
    organiserMobile: optionalText(20),
    organiserEmail: optionalText(150).pipe(z.string().email().nullable()),
    startDate: z.coerce.date().nullish(),
    endDate: z.coerce.date().nullish(),
    category: z.enum(CATEGORIES).nullish(),
    ballType: z.enum(BALL_TYPES).nullish(),
    pitchType: z.enum(PITCH_TYPES).nullish(),
    matchType: z.enum(MATCH_TYPES).nullish(),
    overs: z.number().int().min(1).max(100).nullish(),
    // Default playing conditions for its matches; left out keeps them.
    ballsPerOver: z.number().int().min(4).max(10).nullish(),
    bowlerOverLimit: z.number().int().min(1).max(50).nullish(),
    lastManStands: z.boolean().nullish(),
    freeHit: z.boolean().nullish(),
    // Left out keeps them as they are.
    finished: z.boolean().optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((t) => !t.startDate || !t.endDate || t.endDate >= t.startDate, {
    message: "The end date can't be before the start date",
    path: ["endDate"],
  });

// Multipart flags: "true" removes the current image when no new one is sent.
const imagesSchema = z.object({
  removeLogo: z.literal("true").optional(),
  removeBanner: z.literal("true").optional(),
});

const squadSchema = z.object({ playerIds: z.array(playerId).max(1000) });

const matchSetsSchema = z.object({
  sets: z.array(z.array(playerId).min(1)),
});

const swapSchema = z.object({ playerA: playerId, playerB: playerId });

const moveSchema = z.object({ playerId, toTeamIndex: z.number().int().min(0) });

const teamSchema = z.object({
  name: z.string().trim().min(1).max(60),
  playerIds: z.array(playerId).max(100),
  // Left out = keep the team's current ones.
  captainId: playerId.nullish(),
  viceCaptainId: playerId.nullish(),
  keeperId: playerId.nullish(),
  // Built by hand (left out = generated, or keep it as it is when editing).
  manual: z.boolean().optional(),
});

const teamRolesSchema = z.object({
  captainId: playerId.nullable(),
  viceCaptainId: playerId.nullable(),
  keeperId: playerId.nullable(),
});

const addTeamsSchema = z.object({ teams: z.array(teamSchema).min(1).max(cricketService.MAX_TEAMS) });

const teamIndex = (req: Request) => z.coerce.number().int().min(0).parse(req.params.index);

export async function listPlayersHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.listPlayers(viewerOf(req).isSuperAdmin) });
}

// Public: the sign-in screen's "Next" — which step this number/email gets.
export async function signInLookupHandler(req: Request, res: Response) {
  const { identifier } = z.object({ identifier: z.string().trim().min(1).max(200) }).parse(req.body);
  res.json({ data: await cricketService.lookupSignIn(identifier) });
}

// Public: creates the account and signs straight in (a remembered session).
export async function signUpHandler(req: Request, res: Response) {
  const account = await cricketService.signUp(signUpSchema.parse(req.body));
  res.status(201).json({ data: issueToken(account, true) });
}

// Returns a fresh token, since the name and mobile ride in it.
export async function updateMyProfileHandler(req: Request, res: Response) {
  const account = await cricketService.updateMyProfile(viewerOf(req).adminId, profileSchema.parse(req.body));
  res.json({ data: issueToken(account, Boolean(req.admin!.remember)) });
}

export async function setMyPhotoHandler(req: Request, res: Response) {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const { removePhoto } = z.object({ removePhoto: z.literal("true").optional() }).parse(req.body);
  res.json({ data: await cricketService.setMyPhoto(viewerOf(req).adminId, files.photo?.[0], removePhoto === "true") });
}

export async function meHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.getMe(viewerOf(req).adminId) });
}

// The signed-in player's QR code token (My QR code), refreshed by the app
// while it's shown.
export async function myQrHandler(req: Request, res: Response) {
  const me = await cricketService.findMyPlayer(viewerOf(req).adminId);
  if (!me) throw NotFoundError("Only players have a QR code");
  res.json({ data: { playerId: me.id, ...playerQrToken(me.id) } });
}

export async function playerCareerHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.getPlayerCareer(parseId(req.params.id), viewerOf(req)) });
}

export async function grantPlayerLoginHandler(req: Request, res: Response) {
  const { password } = loginSchema.parse(req.body);
  await cricketService.grantPlayerLogin(parseId(req.params.id), password, viewerOf(req).adminId);
  res.status(204).send();
}

export async function playerInviteHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.playerInvite(parseId(req.params.id), viewerOf(req)) });
}

export async function resetPlayerLoginHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.resetPlayerLogin(parseId(req.params.id)) });
}

export async function revokePlayerLoginHandler(req: Request, res: Response) {
  await cricketService.revokePlayerLogin(parseId(req.params.id));
  res.status(204).send();
}

// Anyone organising a tournament adds players to its squad; only super
// admins get a clash for a number that's already on the list.
export async function createPlayerHandler(req: Request, res: Response) {
  const input = playerSchema.parse(req.body);
  const created = viewerOf(req).isSuperAdmin
    ? await cricketService.createPlayer(input)
    : await cricketService.findOrCreatePlayer(input);
  res.status(201).json({ data: created });
}

export async function lookupPlayerHandler(req: Request, res: Response) {
  const { mobile } = z.object({ mobile: mobileSchema }).parse(req.query);
  res.json({ data: await cricketService.lookupPlayer(mobile) });
}

export async function createPlayersBulkHandler(req: Request, res: Response) {
  const { players } = bulkPlayersSchema.parse(req.body);
  res.status(201).json({ data: await cricketService.createPlayersBulk(players) });
}

export async function updatePlayerHandler(req: Request, res: Response) {
  const updated = await cricketService.updatePlayer(parseId(req.params.id), playerSchema.parse(req.body));
  res.json({ data: updated });
}

export async function updatePlayerStyleHandler(req: Request, res: Response) {
  const updated = await cricketService.updatePlayerStyle(
    parseId(req.params.id),
    playerStyleSchema.parse(req.body),
    viewerOf(req).isSuperAdmin,
  );
  res.json({ data: updated });
}

export async function setPlayerPhotoHandler(req: Request, res: Response) {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const { removePhoto } = z.object({ removePhoto: z.literal("true").optional() }).parse(req.body);
  const updated = await cricketService.setPlayerPhoto(parseId(req.params.id), files.photo?.[0], removePhoto === "true");
  res.json({ data: updated });
}

export async function deletePlayerHandler(req: Request, res: Response) {
  await cricketService.deletePlayer(parseId(req.params.id));
  res.status(204).send();
}

export async function listTournamentsHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.listTournaments(viewerOf(req)) });
}

export async function getTournamentHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const viewer = viewerOf(req);
  await cricketService.assertCanViewTournament(id, viewer);
  const [tournament, me] = await Promise.all([cricketService.getTournament(id), cricketService.findMyPlayer(viewer.adminId)]);
  res.json({ data: cricketService.withoutContacts(tournament, viewer, me?.id ?? null) });
}

export async function createTournamentHandler(req: Request, res: Response) {
  const created = await cricketService.createTournament(tournamentSchema.parse(req.body), viewerOf(req).adminId);
  res.status(201).json({ data: created });
}

export async function updateTournamentHandler(req: Request, res: Response) {
  const updated = await cricketService.updateTournament(parseId(req.params.id), tournamentSchema.parse(req.body));
  res.json({ data: updated });
}

export async function setTournamentImagesHandler(req: Request, res: Response) {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const flags = imagesSchema.parse(req.body);
  const updated = await cricketService.setTournamentImages(parseId(req.params.id), {
    logo: files.logo?.[0],
    banner: files.banner?.[0],
    removeLogo: flags.removeLogo === "true",
    removeBanner: flags.removeBanner === "true",
  });
  res.json({ data: updated });
}

export async function deleteTournamentHandler(req: Request, res: Response) {
  await cricketService.deleteTournament(parseId(req.params.id));
  res.status(204).send();
}

export async function setSquadHandler(req: Request, res: Response) {
  const { playerIds } = squadSchema.parse(req.body);
  res.json({ data: await cricketService.setSquad(parseId(req.params.id), playerIds) });
}

export async function setMatchSetsHandler(req: Request, res: Response) {
  const { sets } = matchSetsSchema.parse(req.body);
  res.json({ data: await cricketService.setMatchSets(parseId(req.params.id), sets) });
}

export async function generateTeamsHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.generateTeams(parseId(req.params.id)) });
}

export async function swapPlayersHandler(req: Request, res: Response) {
  const { playerA, playerB } = swapSchema.parse(req.body);
  res.json({ data: await cricketService.swapPlayers(parseId(req.params.id), playerA, playerB) });
}

export async function movePlayerHandler(req: Request, res: Response) {
  const { playerId: id, toTeamIndex } = moveSchema.parse(req.body);
  res.json({ data: await cricketService.movePlayer(parseId(req.params.id), id, toTeamIndex) });
}

export async function addTeamsHandler(req: Request, res: Response) {
  const { teams } = addTeamsSchema.parse(req.body);
  res.status(201).json({ data: await cricketService.addTeams(parseId(req.params.id), teams) });
}

export async function updateTeamHandler(req: Request, res: Response) {
  const team = teamSchema.parse(req.body);
  res.json({ data: await cricketService.updateTeam(parseId(req.params.id), teamIndex(req), team) });
}

// Players for a team: by mobile, or a known player by their QR code.
const teamPlayersSchema = z.object({
  players: z
    .array(
      z.union([
        z.object({ playerQr: z.string().trim().min(1).max(100) }),
        z.object({ mobile: mobileSchema, name: playerName.pipe(z.string().min(1).max(100)).optional() }),
      ]),
    )
    .min(1)
    .max(100),
});

// Captain (or super admin) only — checked in the service.
export async function lookupTeamPlayerHandler(req: Request, res: Response) {
  const { mobile } = z.object({ mobile: mobileSchema }).parse(req.query);
  res.json({
    data: await cricketService.lookupTeamPlayer(parseId(req.params.id), teamIndex(req), mobile, viewerOf(req)),
  });
}

export async function addTeamPlayersHandler(req: Request, res: Response) {
  const { players } = teamPlayersSchema.parse(req.body);
  res.json({
    data: await cricketService.addTeamPlayers(parseId(req.params.id), teamIndex(req), teamRows(players), viewerOf(req)),
  });
}

// The team's captain (checked in the service) adds players to its upcoming
// friendly matches.
export async function listTeamPlayersHandler(req: Request, res: Response) {
  const { key } = z.object({ key: z.string().trim().min(1).max(120) }).parse(req.query);
  res.json({ data: await cricketService.listTeamPlayers(key) });
}

export async function addFriendlyTeamPlayersHandler(req: Request, res: Response) {
  const { teamName, teamKey, players } = teamPlayersSchema
    .extend({ teamName: z.string().trim().min(1).max(60), teamKey: z.string().trim().min(1).max(120).optional() })
    .parse(req.body);
  res.json({ data: await cricketService.addFriendlyTeamPlayers(teamName, teamRows(players), viewerOf(req), teamKey) });
}

export async function setTournamentOrganisersHandler(req: Request, res: Response) {
  const { playerIds } = scorersSchema.parse(req.body);
  res.json({ data: await cricketService.setTournamentOrganisers(parseId(req.params.id), playerIds) });
}

export async function mergePlayersHandler(req: Request, res: Response) {
  const { intoId } = z.object({ intoId: playerId }).parse(req.body);
  res.json({ data: await cricketService.mergePlayers(parseId(req.params.id), intoId) });
}

export async function setTeamRolesHandler(req: Request, res: Response) {
  const roles = teamRolesSchema.parse(req.body);
  res.json({ data: await cricketService.setTeamRoles(parseId(req.params.id), teamIndex(req), roles) });
}

export async function setTournamentScorersHandler(req: Request, res: Response) {
  const { playerIds } = scorersSchema.parse(req.body);
  res.json({ data: await cricketService.setTournamentScorers(parseId(req.params.id), playerIds) });
}

// Multipart: a "logo" file, or removeLogo=true to clear it.
export async function setTeamLogoHandler(req: Request, res: Response) {
  const logo = (req.files as Record<string, Express.Multer.File[]> | undefined)?.logo?.[0];
  const { removeLogo } = z.object({ removeLogo: z.literal("true").optional() }).parse(req.body);
  if (!logo && removeLogo !== "true") throw BadRequestError("Choose a logo");
  res.json({ data: await cricketService.setTeamLogo(parseId(req.params.id), teamIndex(req), logo ?? null) });
}

export async function removeTeamHandler(req: Request, res: Response) {
  res.json({ data: await cricketService.removeTeam(parseId(req.params.id), teamIndex(req)) });
}

// The format (phases, groups, bracket) with its first fixtures.
export async function setFormatHandler(req: Request, res: Response) {
  const { format, fixtures } = formatService.setFormatSchema.parse(req.body);
  res.json({ data: await formatService.setFormat(parseId(req.params.id), format, fixtures, viewerOf(req).adminId) });
}

// A later phase's groups and fixtures, or the next bracket match.
export async function addFixturesHandler(req: Request, res: Response) {
  const input = formatService.addFixturesSchema.parse(req.body);
  res.status(201).json({ data: await formatService.addFixtures(parseId(req.params.id), input, viewerOf(req).adminId) });
}

export async function clearFormatHandler(req: Request, res: Response) {
  res.json({ data: await formatService.clearFormat(parseId(req.params.id)) });
}
