import type { Request, Response } from "express";
import { z } from "zod";
import * as certificationService from "./certification.service";
import { scopedProfileId } from "../../middleware/portfolioScope";
import { parseId } from "../../utils/parseId";

export async function listCertificationHandler(req: Request, res: Response) {
  const items = await certificationService.listCertification(scopedProfileId(req));
  res.json({ data: items });
}

const certificationSchema = z.object({
  name: z.string().min(1),
  issuingOrganization: z.string().min(1),
  issueDate: z.string(),
  expirationDate: z.string().nullable().optional(),
  credentialId: z.string().nullable().optional(),
  credentialUrl: z.string().url().nullable().optional(),
});

export async function createCertificationHandler(req: Request, res: Response) {
  const input = certificationSchema.parse(req.body);
  const userProfileId = scopedProfileId(req);
  const created = await certificationService.createCertification({ ...input, userProfileId });
  res.status(201).json({ data: created });
}

export async function updateCertificationHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = certificationSchema.partial().parse(req.body);
  const updated = await certificationService.updateCertification(id, scopedProfileId(req), input);
  res.json({ data: updated });
}

export async function deleteCertificationHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await certificationService.deleteCertification(id, scopedProfileId(req));
  res.status(204).send();
}
