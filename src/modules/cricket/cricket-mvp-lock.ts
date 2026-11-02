import type { Prisma } from "@prisma/client";
import { z } from "zod";

const points = z.number().finite();
const playerId = z.number().int().positive();
const awardId = playerId.nullable();

const sourceSchema = z.object({
  group: z.enum(["batting", "bowling", "fielding"]),
  kind: z.string().max(20),
  count: points,
  base: points,
  points,
});

const rowSchema = z.object({
  playerId,
  team: z.number().int().min(0).max(1),
  batting: points,
  bowling: points,
  fielding: points,
  total: points,
  sources: z.array(sourceSchema).max(20),
  bat: z.object({ runs: points, balls: points, fours: points, sixes: points, out: z.boolean() }).nullable(),
  bowl: z.object({ wickets: points, runs: points, legalBalls: points, maidens: points, dots: points }).nullable(),
  catches: points,
  stumpings: points,
  runOuts: points,
});

export const mvpLockSchema = z.object({
  rows: z.array(rowSchema).max(100),
  autoPlayerOfMatchId: awardId,
  fighterId: awardId,
  bestBatterId: awardId,
  bestBowlerId: awardId,
  bestFielderId: awardId,
});

export type MvpLock = z.infer<typeof mvpLockSchema>;

const AWARDS = ["autoPlayerOfMatchId", "fighterId", "bestBatterId", "bestBowlerId", "bestFielderId"] as const;

// A merged player keeps the points they were locked with, under their new id.
export function renameInMvpLock(lock: Prisma.JsonValue, fromId: bigint, intoId: bigint): Prisma.InputJsonValue {
  const from = Number(fromId);
  const into = Number(intoId);
  const saved = lock as unknown as MvpLock;
  const renamed: MvpLock = { ...saved, rows: saved.rows.map((row) => (row.playerId === from ? { ...row, playerId: into } : row)) };
  for (const award of AWARDS) {
    if (saved[award] === from) renamed[award] = into;
  }
  return renamed as unknown as Prisma.InputJsonValue;
}
