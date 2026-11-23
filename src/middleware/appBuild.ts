import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

// Tells the Pocket Android app when a newer copy of the web app is out, on
// every API reply, so it can fetch the update straight away instead of
// asking on a timer. The newest copy is named by Pocket's
// /app-update/latest.json (written by its build). This server reads that
// file at most once a minute (per running instance) and only while
// requests come in; phones never ask for it unless the header says
// something newer is there.

const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;

export const APP_BUILD_HEADER = "X-App-Build";

let latest: string | null = null;
let fetchedAt = 0;
let refreshing: Promise<void> | null = null;

function refresh() {
  if (!env.appUpdateUrl || refreshing || Date.now() - fetchedAt < REFRESH_MS) return;
  fetchedAt = Date.now();
  refreshing = fetch(env.appUpdateUrl, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { version?: unknown };
      if (typeof body.version === "string") latest = body.version;
    })
    // Pocket mid-deploy or unreachable: keep the last answer and try again
    // after the next minute.
    .catch(() => {})
    .finally(() => {
      refreshing = null;
    });
}

export function appBuildHeader(_req: Request, res: Response, next: NextFunction) {
  // Never waits for the file: this reply carries what is already known,
  // and the refresh lands in time for the next one.
  refresh();
  if (latest) res.setHeader(APP_BUILD_HEADER, latest);
  next();
}
