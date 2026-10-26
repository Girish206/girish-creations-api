import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

// Serverless instances share no memory, so the counts live in MongoDB's
// "rate_limits" collection: one document per key, holding how many hits it
// has had and when its window ends. A single findAndModify bumps the count
// (or starts a new window once the old one is over), so concurrent requests
// can't both slip under the limit.
async function hit(key: string, windowMs: number): Promise<number> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const open = { $gt: ["$resetAt", { $literal: now }] };
  const result = (await prisma.$runCommandRaw({
    findAndModify: "rate_limits",
    query: { _id: key },
    update: [
      {
        $set: {
          count: { $cond: [open, { $add: ["$count", 1] }, 1] },
          resetAt: { $cond: [open, "$resetAt", { $literal: resetAt }] },
        },
      },
    ],
    new: true,
    upsert: true,
  })) as { value: { count: unknown } };
  const count = result.value.count;
  return typeof count === "object" && count !== null ? Number(Object.values(count)[0]) : Number(count);
}

// The caller's address: Vercel puts the real client first in
// x-forwarded-for (and in x-real-ip).
export function clientIp(req: Request) {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

const tooMany = (minutes: number) =>
  new HttpError(429, `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, "RATE_LIMITED");

// Throws once `key` has been used more than `limit` times in the window.
export async function assertWithinLimit(key: string, limit: number, windowMs: number) {
  if ((await hit(key, windowMs)) > limit) throw tooMany(Math.ceil(windowMs / 60_000));
}

// The same, as middleware: `name` keeps each route's counts apart, and
// `keyOf` picks what's counted (the caller's address by default).
export function rateLimit(name: string, limit: number, windowMs: number, keyOf: (req: Request) => string = clientIp) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    await assertWithinLimit(`${name}:${keyOf(req)}`, limit, windowMs);
    next();
  };
}
