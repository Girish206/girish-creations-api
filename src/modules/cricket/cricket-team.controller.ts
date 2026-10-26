import type { Request, Response } from "express";
import { z } from "zod";
import * as teamService from "./cricket-team.service";
import * as inviteService from "./cricket-invite.service";
import { parseId } from "../../utils/parseId";
import { mobileSchema } from "../../utils/mobile";
import { viewerOf } from "./cricket.controller";
import { teamRows } from "./cricket-qr";
import { BadRequestError } from "../../utils/httpError";

// Saved teams (teams made outside any tournament). Who may change one is
// checked in the service.

const playerId = z.coerce.bigint().positive();
const teamName = z.string().trim().min(1).max(60);
const playerName = z.string().transform((name) => name.trim().replace(/\s+/g, " "));

const updateSchema = z.object({ name: teamName.optional(), playerIds: z.array(playerId).max(100).optional() });
const rolesSchema = z.object({
  captainId: playerId.nullable(),
  viceCaptainId: playerId.nullable(),
  keeperId: playerId.nullable(),
});
const playersSchema = z.object({
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

export async function createSavedTeamHandler(req: Request, res: Response) {
  const { name } = z.object({ name: teamName }).parse(req.body);
  res.status(201).json({ data: await teamService.createSavedTeam(name, viewerOf(req)) });
}

export async function getSavedTeamHandler(req: Request, res: Response) {
  res.json({ data: await teamService.getSavedTeam(parseId(req.params.id), viewerOf(req)) });
}

export async function updateSavedTeamHandler(req: Request, res: Response) {
  res.json({ data: await teamService.updateSavedTeam(parseId(req.params.id), updateSchema.parse(req.body), viewerOf(req)) });
}

export async function setSavedTeamRolesHandler(req: Request, res: Response) {
  res.json({ data: await teamService.setSavedTeamRoles(parseId(req.params.id), rolesSchema.parse(req.body), viewerOf(req)) });
}

export async function addSavedTeamPlayersHandler(req: Request, res: Response) {
  const { players } = playersSchema.parse(req.body);
  res.json({ data: await teamService.addSavedTeamPlayers(parseId(req.params.id), teamRows(players), viewerOf(req)) });
}

// Multipart: a "logo" file, or removeLogo=true to clear it.
const removeLogoSchema = z.object({ removeLogo: z.literal("true").optional() });

export async function setSavedTeamLogoHandler(req: Request, res: Response) {
  const logo = (req.files as Record<string, Express.Multer.File[]> | undefined)?.logo?.[0];
  const { removeLogo } = removeLogoSchema.parse(req.body);
  if (!logo && removeLogo !== "true") throw BadRequestError("Choose a logo");
  res.json({ data: await teamService.setSavedTeamLogo(parseId(req.params.id), logo ?? null, viewerOf(req)) });
}

export async function deleteSavedTeamHandler(req: Request, res: Response) {
  await teamService.deleteSavedTeam(parseId(req.params.id), viewerOf(req));
  res.status(204).end();
}

// Team join links (cricket-invite.service.ts). Codes are kept upper case.
const inviteCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{4,20}$/)
  .transform((code) => code.toUpperCase());

export async function savedTeamInviteHandler(req: Request, res: Response) {
  const target = { savedTeamId: parseId(req.params.id) };
  res.json({ data: await inviteService.teamInviteCode(target, viewerOf(req), { fresh: req.method === "POST" }) });
}

export async function tournamentTeamInviteHandler(req: Request, res: Response) {
  const target = { tournamentId: parseId(req.params.id), teamIndex: z.coerce.number().int().min(0).parse(req.params.index) };
  res.json({ data: await inviteService.teamInviteCode(target, viewerOf(req), { fresh: req.method === "POST" }) });
}

export async function invitePreviewHandler(req: Request, res: Response) {
  res.json({ data: await inviteService.invitePreview(inviteCode.parse(req.params.code), viewerOf(req)) });
}

export async function joinTeamHandler(req: Request, res: Response) {
  res.json({ data: await inviteService.joinByCode(inviteCode.parse(req.params.code), viewerOf(req)) });
}
