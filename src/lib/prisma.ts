import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// BigInt primary keys (Django's BigAutoField) don't serialize via JSON.stringify by
// default. Values on this single-owner portfolio site never approach
// Number.MAX_SAFE_INTEGER, so converting to Number for API responses is safe.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function () {
  return Number(this);
};

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    // Managed hosts (Aiven, PlanetScale, etc.) require TLS and reject plain
    // connections outright; local dev MySQL has no cert to validate against.
    ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
  };
}

const adapter = new PrismaMariaDb({
  ...parseDatabaseUrl(env.databaseUrl),
  connectionLimit: 5,
  // The mariadb pool's default socket-connect timeout (~1s) is too short
  // for a remote managed host over TLS (Aiven, etc.) — bump it well past
  // typical handshake latency instead of failing the very first request.
  connectTimeout: 15000,
});

export const prisma = new PrismaClient({ adapter });
