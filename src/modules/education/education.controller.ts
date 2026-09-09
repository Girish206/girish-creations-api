import type { Request, Response } from "express";
import { z } from "zod";
import * as educationService from "./education.service";
import { getProfileId } from "../profile/profile.service";
import { parseId } from "../../utils/parseId";

export async function listEducationHandler(_req: Request, res: Response) {
  const items = await educationService.listEducation();
  res.json({ data: items });
}

const educationSchema = z.object({
  course: z.string().min(1),
  institutionName: z.string().min(1),
  specialization: z.string().nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  grade: z.union([z.number(), z.string()]),
});

export async function createEducationHandler(req: Request, res: Response) {
  const input = educationSchema.parse(req.body);
  const userProfileId = await getProfileId();
  const created = await educationService.createEducation({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function updateEducationHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = educationSchema.partial().parse(req.body);
  const updated = await educationService.updateEducation(id, input);
  res.json({ data: updated });
}

export async function deleteEducationHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await educationService.deleteEducation(id);
  res.status(204).send();
}
