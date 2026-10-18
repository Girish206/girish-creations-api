import type { Request, Response } from "express";
import { z } from "zod";
import * as toolService from "./tool.service";
import { scopedProfileId } from "../../middleware/portfolioScope";
import { parseId } from "../../utils/parseId";

export async function listToolHandler(req: Request, res: Response) {
  const items = await toolService.listTool(scopedProfileId(req));
  res.json({ data: items });
}

const toolSchema = z.object({
  toolName: z.string().min(1),
});

export async function createToolHandler(req: Request, res: Response) {
  const input = toolSchema.parse(req.body);
  const userProfileId = scopedProfileId(req);
  const created = await toolService.createTool({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function updateToolHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = toolSchema.partial().parse(req.body);
  const updated = await toolService.updateTool(id, scopedProfileId(req), input);
  res.json({ data: updated });
}

export async function deleteToolHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await toolService.deleteTool(id, scopedProfileId(req));
  res.status(204).send();
}
