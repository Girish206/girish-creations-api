import type { Request, Response } from "express";
import { z } from "zod";
import * as followService from "./cricket-follow.service";
import { viewerOf } from "./cricket.controller";

// From the body (follow) or the query string (unfollow, counts). A team
// needs its index; the other kinds drop it.
const targetSchema = z
  .object({
    kind: z.enum(["player", "team", "tournament"]),
    targetId: z.coerce.bigint().positive(),
    teamIndex: z.coerce.number().int().min(0).nullish(),
  })
  .refine((t) => t.kind !== "team" || t.teamIndex != null, { message: "Choose a team", path: ["teamIndex"] })
  .transform((t) => ({ ...t, teamIndex: t.kind === "team" ? t.teamIndex! : null }));

export async function listMyFollowsHandler(req: Request, res: Response) {
  res.json({ data: await followService.listMyFollows(viewerOf(req).adminId) });
}

export async function followHandler(req: Request, res: Response) {
  res.json({ data: await followService.follow(viewerOf(req).adminId, targetSchema.parse(req.body)) });
}

export async function unfollowHandler(req: Request, res: Response) {
  res.json({ data: await followService.unfollow(viewerOf(req).adminId, targetSchema.parse(req.query)) });
}

export async function followCountsHandler(req: Request, res: Response) {
  res.json({ data: await followService.followCounts(targetSchema.parse(req.query)) });
}
