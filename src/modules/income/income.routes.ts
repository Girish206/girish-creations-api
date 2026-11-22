import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAdminAuth, requireModuleAccess } from "../../middleware/auth";
import { amountSchema, dateSchema } from "../../utils/money";
import { NotFoundError } from "../../utils/httpError";
import { parseId } from "../../utils/parseId";
import { toRupees } from "../expense/foreign-currency";

// Money someone received: salary, freelance work, a refund, interest. It's
// private — each person sees and changes only their own, super admins too
// (it's personal finance, not something to oversee).

const ownerOf = (req: Request) => BigInt(req.admin!.sub);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: day.optional(), to: day.optional() });

async function list(req: Request, res: Response) {
  const { from, to } = rangeSchema.parse(req.query);
  const rows = await prisma.income.findMany({
    where: {
      ownerAdminUserId: ownerOf(req),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lt: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  res.json({ data: rows });
}

const incomeSchema = z.object({
  amount: amountSchema,
  date: dateSchema,
  // The category: "Salary", "Freelance", … or anything typed.
  source: z.string().trim().min(1, "Pick a category").max(60),
  description: z.string().trim().max(200).nullable().optional(),
  // Received in another currency (see foreign-currency.ts). Empty or "INR"
  // means rupees.
  originalCurrency: z.string().trim().max(3).nullable().optional(),
  originalAmount: z.coerce.string().trim().nullable().optional(),
  exchangeRate: z.coerce.string().trim().nullable().optional(),
});

// The rupee amount and foreign fields to save. As for expenses, a foreign
// amount's rupee value is worked out here, never taken from the client.
// Undefined when the currency wasn't sent (an update leaving it as it is).
function currencyFields(input: Partial<z.infer<typeof incomeSchema>>) {
  if (input.originalCurrency === undefined) return undefined;
  if (!input.originalCurrency || input.originalCurrency.toUpperCase() === "INR") {
    return { originalAmount: null, originalCurrency: null, exchangeRate: null };
  }
  const { amount, foreign } = toRupees(input);
  return { amount, ...foreign };
}

async function create(req: Request, res: Response) {
  const input = incomeSchema.parse(req.body);
  const row = await prisma.income.create({
    data: {
      ownerAdminUserId: ownerOf(req),
      amount: input.amount,
      date: new Date(input.date.slice(0, 10)),
      source: input.source,
      description: input.description || null,
      ...currencyFields(input),
    },
  });
  res.status(201).json({ data: row });
}

async function findOwn(req: Request) {
  const id = parseId(req.params.id);
  const row = await prisma.income.findUnique({ where: { id } });
  if (!row || row.ownerAdminUserId !== ownerOf(req)) throw NotFoundError("Income not found");
  return row;
}

async function update(req: Request, res: Response) {
  const existing = await findOwn(req);
  const input = incomeSchema.partial().parse(req.body);
  const row = await prisma.income.update({
    where: { id: existing.id },
    data: {
      amount: input.amount,
      date: input.date ? new Date(input.date.slice(0, 10)) : undefined,
      source: input.source,
      description: input.description !== undefined ? input.description || null : undefined,
      ...currencyFields(input),
    },
  });
  res.json({ data: row });
}

async function remove(req: Request, res: Response) {
  const existing = await findOwn(req);
  await prisma.income.delete({ where: { id: existing.id } });
  res.status(204).send();
}

const access = [requireAdminAuth, requireModuleAccess("expenses")];

export const incomeAdminRouter = Router();
incomeAdminRouter.get("/", ...access, asyncHandler(list));
incomeAdminRouter.post("/", ...access, asyncHandler(create));
incomeAdminRouter.put("/:id", ...access, asyncHandler(update));
incomeAdminRouter.delete("/:id", ...access, asyncHandler(remove));
