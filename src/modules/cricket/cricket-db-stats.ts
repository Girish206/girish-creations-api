import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// $runCommandRaw returns extended JSON, so a figure can come back as a plain
// number or wrapped, e.g. { $numberLong: "12" } or { $numberDouble: "1.5" }.
function toNumber(value: unknown): number {
  if (typeof value === "object" && value !== null) {
    return Number(Object.values(value)[0]);
  }
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

type Raw = Record<string, unknown>;

// A command the database user may not be allowed to run (Atlas's shared
// tiers refuse serverStatus, for one) leaves its part of the page out.
async function tryCommand(command: Record<string, unknown>): Promise<Raw | null> {
  try {
    return (await prisma.$runCommandRaw(command as never)) as Raw;
  } catch {
    return null;
  }
}

async function collectionStats(name: string) {
  const result = await tryCommand({
    aggregate: name,
    pipeline: [{ $collStats: { storageStats: {} } }],
    cursor: {},
  });
  const batch = ((result?.cursor as Raw | undefined)?.firstBatch as Raw[] | undefined) ?? [];
  if (batch.length > 0) {
    // One entry per shard; an unsharded cluster has just the one.
    const sum = (field: string) =>
      batch.reduce((total, entry) => total + toNumber((entry.storageStats as Raw)?.[field]), 0);
    const count = sum("count");
    const size = sum("size");
    return {
      name,
      count,
      size,
      avgObjSize: count > 0 ? size / count : 0,
      storageSize: sum("storageSize"),
      indexes: toNumber((batch[0].storageStats as Raw)?.nindexes),
      indexSize: sum("totalIndexSize"),
    };
  }
  // No $collStats: the document count alone.
  const counted = await tryCommand({ count: name });
  return { name, count: toNumber(counted?.n), size: null, avgObjSize: null, storageSize: null, indexes: null, indexSize: null };
}

// GET /admin/cricket/db-stats (super admins): the size of the MongoDB
// database the whole Girish Creations API shares, collection by collection.
export async function dbStatsHandler(_req: Request, res: Response) {
  const started = Date.now();
  await prisma.$runCommandRaw({ ping: 1 });
  const pingMs = Date.now() - started;

  const [db, build, server, listed] = await Promise.all([
    tryCommand({ dbStats: 1, scale: 1 }),
    tryCommand({ buildInfo: 1 }),
    tryCommand({ serverStatus: 1, repl: 0, metrics: 0, locks: 0, wiredTiger: 0 }),
    tryCommand({ listCollections: 1, nameOnly: true, authorizedCollections: true, filter: { type: "collection" } }),
  ]);

  const names = (((listed?.cursor as Raw | undefined)?.firstBatch as Raw[] | undefined) ?? [])
    .map((c) => String(c.name))
    .filter((name) => !name.startsWith("system."));
  const collections = (await Promise.all(names.map(collectionStats))).sort(
    (a, b) => (b.storageSize ?? 0) + (b.indexSize ?? 0) - ((a.storageSize ?? 0) + (a.indexSize ?? 0)) || b.count - a.count,
  );

  const connections = server?.connections as Raw | undefined;
  res.json({
    data: {
      database: db ? String(db.db) : null,
      version: build ? String(build.version) : null,
      pingMs,
      totals: db
        ? {
            collections: toNumber(db.collections),
            views: toNumber(db.views),
            objects: toNumber(db.objects),
            avgObjSize: toNumber(db.avgObjSize),
            dataSize: toNumber(db.dataSize),
            storageSize: toNumber(db.storageSize),
            indexes: toNumber(db.indexes),
            indexSize: toNumber(db.indexSize),
            totalSize: toNumber(db.totalSize) || toNumber(db.storageSize) + toNumber(db.indexSize),
            fsUsedSize: db.fsUsedSize !== undefined ? toNumber(db.fsUsedSize) : null,
            fsTotalSize: db.fsTotalSize !== undefined ? toNumber(db.fsTotalSize) : null,
          }
        : null,
      server: server
        ? {
            uptimeSeconds: toNumber(server.uptime),
            connections: connections
              ? { current: toNumber(connections.current), available: toNumber(connections.available) }
              : null,
          }
        : null,
      collections,
      checkedAt: new Date().toISOString(),
    },
  });
}
