import type { Request, Response } from "express";
import { z } from "zod";
import * as investmentService from "./investment.service";
import { parseId } from "../../utils/parseId";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isOwner: req.admin!.isOwner };
}

export async function listInvestmentsHandler(req: Request, res: Response) {
  const items = await investmentService.listInvestments(requestingAdmin(req));
  res.json({ data: items });
}

const investmentSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  amountInvested: z.coerce.string().min(1),
  currentValue: z.coerce.string().nullable().optional(),
  date: z.string(),
  notes: z.string().nullable().optional(),
  investedByAdminUserId: z.coerce.bigint().optional(),
});

export async function createInvestmentHandler(req: Request, res: Response) {
  const input = investmentSchema.parse(req.body);
  const investedByAdminUserId = input.investedByAdminUserId ?? BigInt(req.admin!.sub);
  const created = await investmentService.createInvestment({ ...input, investedByAdminUserId });
  res.status(201).json({ data: created });
}

export async function updateInvestmentHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = investmentSchema.partial().parse(req.body);
  const updated = await investmentService.updateInvestment(id, input, requestingAdmin(req));
  res.json({ data: updated });
}

export async function deleteInvestmentHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await investmentService.deleteInvestment(id, requestingAdmin(req));
  res.status(204).send();
}
