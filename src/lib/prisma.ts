import { PrismaClient } from "@prisma/client";

// BigInt primary keys (Django's BigAutoField) don't serialize via JSON.stringify by
// default. Values on this single-owner portfolio site never approach
// Number.MAX_SAFE_INTEGER, so converting to Number for API responses is safe.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function () {
  return Number(this);
};

const base = new PrismaClient();

// $runCommandRaw returns extended JSON, so a counter can come back as a plain
// number (int32) or wrapped, e.g. { $numberLong: "12" }.
function toBigInt(value: unknown): bigint {
  if (typeof value === "object" && value !== null) {
    return BigInt(Object.values(value)[0] as string);
  }
  return BigInt(value as number);
}

// MongoDB has no autoincrement, so each model's next id comes from an atomic
// $inc on its document in the "counters" collection (seeded to the max
// imported id by prisma/import-mysql.ts). Reserves `count` consecutive ids
// and returns the first one.
async function reserveIds(model: string, count: number): Promise<bigint> {
  const result = (await base.$runCommandRaw({
    findAndModify: "counters",
    query: { _id: model },
    update: { $inc: { seq: count } },
    new: true,
    upsert: true,
  })) as { value: { seq: unknown } };
  return toBigInt(result.value.seq) - BigInt(count) + 1n;
}

type WithId = { id?: bigint | number };

export const prisma = base.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const data = args.data as WithId;
        if (!data.id) {
          data.id = await reserveIds(model, 1);
        }
        return query(args);
      },
      async createMany({ model, args, query }) {
        const rows = (Array.isArray(args.data) ? args.data : [args.data]) as WithId[];
        const missing = rows.filter((row) => !row.id);
        if (missing.length > 0) {
          const first = await reserveIds(model, missing.length);
          missing.forEach((row, index) => {
            row.id = first + BigInt(index);
          });
        }
        return query(args);
      },
      async upsert({ model, args, query }) {
        const create = args.create as WithId;
        if (!create.id) {
          create.id = await reserveIds(model, 1);
        }
        return query(args);
      },
    },
  },
});
