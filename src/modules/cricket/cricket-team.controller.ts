import type { Request, Response } from "express";
import { z } from "zod";
import * as teamService from "./cricket-team.service";
import { parseId } from "../../utils/parseId";
import { mobileSchema } from "../../utils/mobile";
import { viewerOf } from "./cricket.controller";

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
    .array(z.object({ mobile: mobileSchema, name: playerName.pipe(z.string().min(1).max(100)).optional() }))
    .min(1)
    .max(100),
});

export async function createSavedTeamHandler(req: Request, res: Response) {
  const { name } = z.object({ name: teamName }).parse(req.body);
  res.status(201).json({ data: await teamService.createSavedTeam(name, viewerOf(req)) });
}

export async function getSavedTeamHandler(req: Request, res: Response) {
  res.json({ data: await teamService.getSavedTeam(parseId(req.params.id)) });
}

export async function updateSavedTeamHandler(req: Request, res: Response) {
  res.json({ data: await teamService.updateSavedTeam(parseId(req.params.id), updateSchema.parse(req.body), viewerOf(req)) });
}

export async function setSavedTeamRolesHandler(req: Request, res: Response) {
  res.json({ data: await teamService.setSavedTeamRoles(parseId(req.params.id), rolesSchema.parse(req.body), viewerOf(req)) });
}

export async function addSavedTeamPlayersHandler(req: Request, res: Response) {
  const { players } = playersSchema.parse(req.body);
  res.json({ data: await teamService.addSavedTeamPlayers(parseId(req.params.id), players, viewerOf(req)) });
}

export async function deleteSavedTeamHandler(req: Request, res: Response) {
  await teamService.deleteSavedTeam(parseId(req.params.id), viewerOf(req));
  res.status(204).end();
}
