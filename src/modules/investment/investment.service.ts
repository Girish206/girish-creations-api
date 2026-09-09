import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../utils/httpError";

const includeRelations = {
  investedBy: { select: { id: true, email: true, name: true } },
} as const;

export interface RequestingAdmin {
  id: bigint;
  isOwner: boolean;
}

// Investments have no split/sharing concept at all — always private to
// whoever logged it, except the owner who sees everything.
export async function listInvestments(admin: RequestingAdmin) {
  return prisma.investment.findMany({
    where: admin.isOwner ? undefined : { investedByAdminUserId: admin.id },
    include: includeRelations,
    orderBy: { date: "desc" },
  });
}

async function assertInvestmentAccess(investment: { investedByAdminUserId: bigint }, admin: RequestingAdmin) {
  if (admin.isOwner) return;
  if (investment.investedByAdminUserId !== admin.id) {
    throw ForbiddenError("You don't have access to this investment");
  }
}

export interface InvestmentInput {
  title: string;
  type: string;
  amountInvested: string;
  currentValue?: string | null;
  date: string;
  notes?: string | null;
  investedByAdminUserId: bigint;
}

export async function createInvestment(input: InvestmentInput) {
  return prisma.investment.create({
    data: {
      title: input.title,
      type: input.type,
      amountInvested: input.amountInvested,
      currentValue: input.currentValue,
      date: new Date(input.date),
      notes: input.notes,
      investedByAdminUserId: input.investedByAdminUserId,
    },
    include: includeRelations,
  });
}

export async function updateInvestment(id: bigint, input: Partial<InvestmentInput>, admin: RequestingAdmin) {
  const existing = await prisma.investment.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Investment not found");
  }
  await assertInvestmentAccess(existing, admin);

  return prisma.investment.update({
    where: { id },
    data: {
      title: input.title,
      type: input.type,
      amountInvested: input.amountInvested,
      currentValue: input.currentValue,
      date: input.date ? new Date(input.date) : undefined,
      notes: input.notes,
      investedByAdminUserId: input.investedByAdminUserId,
    },
    include: includeRelations,
  });
}

export async function deleteInvestment(id: bigint, admin: RequestingAdmin) {
  const existing = await prisma.investment.findUnique({ where: { id } });
  if (!existing) {
    throw NotFoundError("Investment not found");
  }
  await assertInvestmentAccess(existing, admin);
  await prisma.investment.delete({ where: { id } });
}
