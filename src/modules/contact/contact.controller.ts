import type { Request, Response } from "express";
import { z } from "zod";
import * as contactService from "./contact.service";
import { scopedProfileId } from "../../middleware/portfolioScope";
import { parseId } from "../../utils/parseId";
import { parsePagination, paginationSkipTake, buildPaginatedResponse } from "../../utils/pagination";

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
});

export async function createContactHandler(req: Request, res: Response) {
  const input = contactSchema.parse(req.body);
  const created = await contactService.createContactMessage({ ...input, userProfileId: scopedProfileId(req) });
  res.status(201).json({ data: created });
}

export async function listContactHandler(req: Request, res: Response) {
  const params = parsePagination(req.query, 10);
  const { items, total } = await contactService.listContactMessages(scopedProfileId(req), paginationSkipTake(params));
  res.json({ data: buildPaginatedResponse(items, total, params) });
}

export async function deleteContactHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await contactService.deleteContactMessage(id, scopedProfileId(req));
  res.status(204).send();
}
