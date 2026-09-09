import type { Request, Response } from "express";
import { z } from "zod";
import * as contactService from "./contact.service";
import { getProfileId } from "../profile/profile.service";
import { parseId } from "../../utils/parseId";
import { parsePagination, paginationSkipTake, buildPaginatedResponse } from "../../utils/pagination";
import { HttpError } from "../../utils/httpError";

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
});

export async function createContactHandler(req: Request, res: Response) {
  const input = contactSchema.parse(req.body);

  // Best-effort FK: a contact form submission should still succeed even if
  // the singleton profile row doesn't exist yet (e.g. a fresh dev DB).
  let userProfileId: bigint | null = null;
  try {
    userProfileId = await getProfileId();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      userProfileId = null;
    } else {
      throw err;
    }
  }

  const created = await contactService.createContactMessage({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function listContactHandler(req: Request, res: Response) {
  const params = parsePagination(req.query, 10);
  const { items, total } = await contactService.listContactMessages(paginationSkipTake(params));
  res.json({ data: buildPaginatedResponse(items, total, params) });
}

export async function deleteContactHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await contactService.deleteContactMessage(id);
  res.status(204).send();
}
