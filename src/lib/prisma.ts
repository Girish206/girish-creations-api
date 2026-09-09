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
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

const adapter = new PrismaMariaDb({
  ...parseDatabaseUrl(env.databaseUrl),
  connectionLimit: 5,
});

export const prisma = new PrismaClient({ adapter });
