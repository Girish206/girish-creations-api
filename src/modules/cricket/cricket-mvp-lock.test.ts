import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { mvpLockSchema, renameInMvpLock } from "./cricket-mvp-lock";

const row = (playerId: number, total = 5) => ({
  playerId,
  team: 0,
  batting: total,
  bowling: 0,
  fielding: 0,
  total,
  sources: [{ group: "batting" as const, kind: "runs", count: 50, base: total, points: total }],
  bat: { runs: 50, balls: 30, fours: 4, sixes: 1, out: true },
  bowl: null,
  catches: 0,
  stumpings: 0,
  runOuts: 0,
});
const lock = {
  rows: [row(7), row(9, 3)],
  autoPlayerOfMatchId: 7,
  fighterId: 9,
  bestBatterId: 7,
  bestBowlerId: null,
  bestFielderId: null,
};

test("accepts a whole lock and rejects a damaged one", () => {
  assert.deepEqual(mvpLockSchema.parse(lock), lock);
  assert.throws(() => mvpLockSchema.parse({ ...lock, rows: [{ ...row(7), total: "5" }] }));
  assert.throws(() => mvpLockSchema.parse({ ...lock, rows: [{ ...row(7), team: 2 }] }));
  assert.throws(() => mvpLockSchema.parse({ rows: lock.rows }));
  assert.throws(() => mvpLockSchema.parse({ ...lock, rows: Array.from({ length: 101 }, (_, i) => row(i + 1)) }));
});

test("a merged player keeps their locked points and awards under the new id", () => {
  const renamed = renameInMvpLock(lock as unknown as Prisma.JsonValue, 7n, 70n) as unknown as typeof lock;
  assert.deepEqual(renamed.rows.map((r) => r.playerId), [70, 9]);
  assert.equal(renamed.rows[0].total, 5);
  assert.equal(renamed.autoPlayerOfMatchId, 70);
  assert.equal(renamed.bestBatterId, 70);
  assert.equal(renamed.fighterId, 9);
  assert.equal(lock.rows[0].playerId, 7, "the original isn't changed");
});
