import type { Request, Response } from "express";
import { z } from "zod";
import * as savingsGoalService from "./savings-goal.service";
import { parseId } from "../../utils/parseId";

function requestingAdmin(req: Request) {
  return { id: BigInt(req.admin!.sub), isOwner: req.admin!.isOwner };
}

export async function listSavingsGoalsHandler(req: Request, res: Response) {
  const items = await savingsGoalService.listSavingsGoals(requestingAdmin(req));
  res.json({ data: items });
}

const goalSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.coerce.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  accountHolderAdminUserId: z.coerce.bigint().nullable().optional(),
  // Who can see/use this goal — omitted/empty means everyone with access.
  memberAdminUserIds: z.array(z.coerce.bigint()).optional(),
});

export async function createSavingsGoalHandler(req: Request, res: Response) {
  const input = goalSchema.parse(req.body);
  const created = await savingsGoalService.createSavingsGoal(input, BigInt(req.admin!.sub));
  res.status(201).json({ data: created });
}

export async function updateSavingsGoalHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const input = goalSchema.partial().parse(req.body);
  const updated = await savingsGoalService.updateSavingsGoal(id, input, requestingAdmin(req));
  res.json({ data: updated });
}

export async function deleteSavingsGoalHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  await savingsGoalService.deleteSavingsGoal(id, requestingAdmin(req));
  res.status(204).send();
}

const contributionSchema = z.object({
  amount: z.coerce.string().min(1),
  date: z.string(),
  contributedByAdminUserId: z.coerce.bigint().optional(),
});

export async function addSavingsContributionHandler(req: Request, res: Response) {
  const goalId = parseId(req.params.id);
  const input = contributionSchema.parse(req.body);
  const contributedByAdminUserId = input.contributedByAdminUserId ?? BigInt(req.admin!.sub);
  const updated = await savingsGoalService.addSavingsContribution(
    goalId,
    { ...input, contributedByAdminUserId },
    requestingAdmin(req),
  );
  res.status(201).json({ data: updated });
}

export async function deleteSavingsContributionHandler(req: Request, res: Response) {
  const goalId = parseId(req.params.id);
  const contributionId = parseId(req.params.contributionId);
  await savingsGoalService.deleteSavingsContribution(goalId, contributionId, requestingAdmin(req));
  res.status(204).send();
}
