import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// Long polling for live match pages: an ask carrying `since` (the match's
// updatedAt it holds) is held open until the match changes, so a new ball
// reaches every viewer within about a second while each one asks only once
// per ball (or per HOLD_MS when nothing happens).
//
// Everyone waiting on the same match in one server instance shares a single
// watcher, which reads the match's stamp (one small field) once a second and
// stops when nobody is left waiting. Fluid compute runs many asks in one
// instance, so the database sees about one read a second per match, not one
// per viewer.

export const HOLD_MS = 25_000;
const CHECK_MS = 1_000;

type Waiter = { since: string; done: (changed: boolean) => void };
type Watcher = { waiters: Set<Waiter>; timer: NodeJS.Timeout };

const watchers = new Map<bigint, Watcher>();

const stampOf = async (id: bigint) =>
  (await prisma.cricketMatch.findUnique({ where: { id }, select: { updatedAt: true } }))?.updatedAt?.toISOString() ?? null;

function watch(id: bigint) {
  let watcher = watchers.get(id);
  if (watcher) return watcher;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const stamp = await stampOf(id);
      for (const waiter of watchers.get(id)?.waiters ?? []) {
        if (stamp !== waiter.since) waiter.done(true);
      }
    } catch {
      // Try again on the next tick.
    } finally {
      busy = false;
    }
  }, CHECK_MS);
  watcher = { waiters: new Set(), timer };
  watchers.set(id, watcher);
  return watcher;
}

function leave(id: bigint, waiter: Waiter) {
  const watcher = watchers.get(id);
  if (!watcher) return;
  watcher.waiters.delete(waiter);
  if (watcher.waiters.size === 0) {
    clearInterval(watcher.timer);
    watchers.delete(id);
  }
}

// Resolves true once the match's stamp differs from `since` (at once if it
// already does), false when HOLD_MS passes first or `signal` fires (the
// viewer went away). A missing match counts as changed: the full ask that
// follows answers "not found". Answering false needs no access check: it
// only confirms a stamp the caller got from a match it was allowed to see.
export async function waitForChange(id: bigint, since: string, signal: AbortSignal): Promise<boolean> {
  if ((await stampOf(id)) !== since) return true;
  if (signal.aborted) return false;
  return new Promise((resolve) => {
    const waiter: Waiter = {
      since,
      done: (changed) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        leave(id, waiter);
        resolve(changed);
      },
    };
    const onAbort = () => waiter.done(false);
    const timeout = setTimeout(() => waiter.done(false), HOLD_MS);
    signal.addEventListener("abort", onAbort);
    watch(id).waiters.add(waiter);
  });
}

// For a live handler: with `?since=`, waits for a change and answers an
// empty 204 if none came (returns false: nothing more to send). Without it,
// or once the match changed, returns true for the handler to send it.
export async function holdUntilChanged(req: Request, res: Response, id: bigint) {
  const since = req.query.since;
  if (typeof since !== "string" || !since) return true;
  const gone = new AbortController();
  res.on("close", () => gone.abort());
  if (await waitForChange(id, since, gone.signal)) return true;
  if (!res.writableEnded && !gone.signal.aborted) res.status(204).end();
  return false;
}
