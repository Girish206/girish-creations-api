import type { Request, Response } from "express";
import { z } from "zod";
import * as experienceService from "./experience.service";
import { getProfileId } from "../profile/profile.service";
import { parseId } from "../../utils/parseId";

export async function listExperienceHandler(_req: Request, res: Response) {
  const items = await experienceService.listExperience();
  res.json({ data: items });
}

const experienceSchema = z.object({
  jobTitle: z.string().min(1),
  companyName: z.string().min(1),
  location: z.string().nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export async function createExperienceHandler(req: Request, res: Response) {
  const input = experienceSchema.parse(req.body);
  const userProfileId = await getProfileId();
  const created = await experienceService.createExperience({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function updateExperienceHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = experienceSchema.partial().parse(req.body);
  const updated = await experienceService.updateExperience(id, input);
  res.json({ data: updated });
}

export async function deleteExperienceHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await experienceService.deleteExperience(id);
  res.status(204).send();
}
