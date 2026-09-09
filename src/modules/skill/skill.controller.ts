import type { Request, Response } from "express";
import { z } from "zod";
import * as skillService from "./skill.service";
import { getProfileId } from "../profile/profile.service";
import { parseId } from "../../utils/parseId";
import { BadRequestError } from "../../utils/httpError";

const proficiencyLevels = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

export async function listSkillHandler(req: Request, res: Response) {
  const levelParam = req.query.level;
  const levels =
    typeof levelParam === "string" && levelParam.length > 0
      ? levelParam.split(",").map((level) => level.trim())
      : undefined;

  const randomParam = req.query.random;
  let random: number | undefined;
  if (typeof randomParam === "string" && randomParam.length > 0) {
    random = Number.parseInt(randomParam, 10);
    if (Number.isNaN(random) || random < 0) {
      throw BadRequestError("Invalid random query parameter");
    }
  }

  const items = await skillService.listSkill({ levels, random });
  res.json({ data: items });
}

const skillSchema = z.object({
  skillName: z.string().min(1),
  proficiencyLevel: z.enum(proficiencyLevels),
});

export async function createSkillHandler(req: Request, res: Response) {
  const input = skillSchema.parse(req.body);
  const userProfileId = await getProfileId();
  const created = await skillService.createSkill({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function updateSkillHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = skillSchema.partial().parse(req.body);
  const updated = await skillService.updateSkill(id, input);
  res.json({ data: updated });
}

export async function deleteSkillHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await skillService.deleteSkill(id);
  res.status(204).send();
}
