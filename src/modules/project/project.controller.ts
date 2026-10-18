import type { Request, Response } from "express";
import { z } from "zod";
import * as projectService from "./project.service";
import { scopedProfileId } from "../../middleware/portfolioScope";
import { parseId } from "../../utils/parseId";
import { parsePagination, paginationSkipTake, buildPaginatedResponse } from "../../utils/pagination";
import { uploadFile } from "../../middleware/upload";

export async function listProjectsHandler(req: Request, res: Response) {
  const params = parsePagination(req.query, 2);
  const { items, total } = await projectService.listProjects(scopedProfileId(req), paginationSkipTake(params));
  res.json({ data: buildPaginatedResponse(items, total, params) });
}

export async function randomProjectsHandler(req: Request, res: Response) {
  const count = Math.max(1, Number(req.query.count) || 2);
  const items = await projectService.randomProjects(scopedProfileId(req), count);
  res.json({ data: items });
}

export async function getProjectHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const project = await projectService.getProjectById(id, scopedProfileId(req));
  res.json({ data: project });
}

const projectSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  technologiesUsed: z.string().min(1),
  projectUrl: z.string().nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
});

function extractImageFile(req: Request) {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  return files.image?.[0];
}

export async function createProjectHandler(req: Request, res: Response) {
  const input = projectSchema.parse(req.body);
  const userProfileId = scopedProfileId(req);
  const imageFile = extractImageFile(req);

  const created = await projectService.createProject({
    ...input,
    image: imageFile ? await uploadFile(imageFile) : undefined,
    userProfileId,
  });
  res.status(201).json({ data: created });
}

export async function updateProjectHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = projectSchema.partial().parse(req.body);
  const imageFile = extractImageFile(req);

  const updated = await projectService.updateProject(id, scopedProfileId(req), {
    ...input,
    ...(imageFile ? { image: await uploadFile(imageFile) } : {}),
  });
  res.json({ data: updated });
}

export async function deleteProjectHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await projectService.deleteProject(id, scopedProfileId(req));
  res.status(204).send();
}
