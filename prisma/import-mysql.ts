// One-off migration: loads a JSON export of the old MySQL database (one key
// per table, rows as returned by the mariadb driver with dateStrings: true)
// into MongoDB, keeping every original id. Images referenced by the profile
// and projects are read from the old uploads folder and stored in the
// "files" collection, with the references rewritten to "/api/files/<id>".
//
// Usage: npm run import:mysql -- [exportJson] [uploadsDir] [--reset]
//   exportJson  defaults to prisma/mysql-export.json
//   uploadsDir  defaults to ./uploads
//   --reset     wipe the target database first (otherwise a non-empty
//               target aborts the import)
//
// Also creates the indexes the schema declares. `prisma db push` isn't used
// for that because it would create a plain unique index on admin_users.email,
// which rejects more than one guest member (guests have no email); a partial
// index is created here instead.
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { FILE_URL_PREFIX } from "../src/middleware/upload";

type Row = Record<string, unknown>;
type Delegate = {
  count(): Promise<number>;
  deleteMany(): Promise<unknown>;
  createMany(args: { data: Row[] }): Promise<unknown>;
};

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const [exportPath = "prisma/mysql-export.json", uploadsDir = "./uploads"] = args.filter((a) => !a.startsWith("--"));

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

// Columns holding an uploads-relative path ("project_images/foo.jpg").
const FILE_FIELDS: Record<string, string[]> = {
  UserProfile: ["profilePicture", "signature"],
  ProjectDetails: ["image"],
};

// Indexes from schema.prisma, by collection. Prisma's own @@index/@unique
// declarations aren't applied to MongoDB without `db push`.
const INDEXES: Record<string, { key: Record<string, 1>; unique?: boolean; partial?: Row }[]> = {
  admin_users: [{ key: { email: 1 }, unique: true, partial: { email: { $type: "string" } } }],
  blog_posts: [{ key: { slug: 1 }, unique: true }, { key: { user_profile_id: 1 } }],
  expense_categories: [{ key: { name: 1 }, unique: true }],
  expense_split_participants: [{ key: { expense_id: 1, admin_user_id: 1 }, unique: true }, { key: { admin_user_id: 1 } }],
  savings_goal_members: [{ key: { savings_goal_id: 1, admin_user_id: 1 }, unique: true }, { key: { admin_user_id: 1 } }],
  experience_details: [{ key: { user_profile_id: 1 } }],
  education_details: [{ key: { user_profile_id: 1 } }],
  certification_details: [{ key: { user_profile_id: 1 } }],
  skills: [{ key: { user_profile_id: 1 } }],
  tools: [{ key: { user_profile_id: 1 } }],
  contact_messages: [{ key: { user_profile_id: 1 } }],
  projects: [{ key: { user_profile_id: 1 } }],
  expenses: [
    { key: { category_id: 1 } },
    { key: { paid_by_admin_user_id: 1 } },
    { key: { savings_goal_id: 1 } },
    { key: { expense_group_id: 1 } },
  ],
  savings_goals: [{ key: { account_holder_admin_user_id: 1 } }],
  savings_contributions: [{ key: { goal_id: 1 } }, { key: { contributed_by_admin_user_id: 1 } }],
};

function delegateFor(modelName: string): Delegate {
  const key = modelName[0].toLowerCase() + modelName.slice(1);
  return (prisma as unknown as Record<string, Delegate>)[key];
}

// MySQL DATE comes through as "2026-09-09" (stored by Prisma as UTC
// midnight); DATETIME as "2026-09-09 10:36:29.633", which Prisma/Django
// both wrote in UTC.
function toDate(value: unknown): Date {
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(`${text.replace(" ", "T")}Z`);
}

function convert(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "BigInt":
      return BigInt(value as number);
    case "Int":
      return Number(value);
    case "Boolean":
      return Boolean(Number(value));
    case "DateTime":
      return toDate(value);
    case "String":
      return String(value);
    default:
      throw new Error(`Unhandled field type ${type}`);
  }
}

async function main() {
  const dump = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, Row[]>;
  const models = Prisma.dmmf.datamodel.models.filter((m) => m.name !== "StoredFile");

  const nonEmpty: string[] = [];
  for (const model of [...models, { name: "StoredFile" }]) {
    if ((await delegateFor(model.name).count()) > 0) nonEmpty.push(model.name);
  }
  if (nonEmpty.length > 0 && !reset) {
    throw new Error(`Target database already has data (${nonEmpty.join(", ")}). Re-run with --reset to wipe it first.`);
  }
  if (reset) {
    for (const model of [...models, { name: "StoredFile" }]) await delegateFor(model.name).deleteMany();
    await prisma.$runCommandRaw({ delete: "counters", deletes: [{ q: {}, limit: 0 }] });
    console.log("Wiped target database.");
  }

  // Each referenced image is stored once, even if several rows point at it.
  const storedFiles = new Map<string, string>();
  let nextFileId = 1n;
  async function storeImage(relativePath: string): Promise<string | null> {
    const cached = storedFiles.get(relativePath);
    if (cached) return cached;
    const filePath = path.join(uploadsDir, relativePath);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ! missing file ${filePath} — reference cleared`);
      return null;
    }
    const data = fs.readFileSync(filePath);
    const id = nextFileId++;
    await prisma.storedFile.create({
      data: {
        id,
        filename: path.basename(relativePath),
        contentType: CONTENT_TYPES[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream",
        size: data.length,
        data: new Uint8Array(data),
      },
    });
    const url = `${FILE_URL_PREFIX}${id}`;
    storedFiles.set(relativePath, url);
    return url;
  }

  const counters: Record<string, bigint> = {};
  const handledTables = new Set<string>();

  for (const model of models) {
    const table = model.dbName ?? model.name;
    handledTables.add(table);
    const sourceRows = dump[table] ?? [];
    const scalarFields = model.fields.filter((f) => f.kind === "scalar");

    const rows: Row[] = [];
    for (const source of sourceRows) {
      const row: Row = {};
      for (const field of scalarFields) {
        // The id maps to "_id" in Mongo but was the "id" column in MySQL.
        const column = field.isId ? "id" : (field.dbName ?? field.name);
        if (!(column in source)) {
          throw new Error(`${table}.${column} missing from export (field ${model.name}.${field.name})`);
        }
        row[field.name] = convert(source[column], field.type);
      }
      for (const fileField of FILE_FIELDS[model.name] ?? []) {
        const relativePath = row[fileField] as string | null;
        if (relativePath) row[fileField] = await storeImage(relativePath);
      }
      rows.push(row);
    }

    if (rows.length > 0) {
      await delegateFor(model.name).createMany({ data: rows });
    }
    counters[model.name] = rows.reduce((max, r) => ((r.id as bigint) > max ? (r.id as bigint) : max), 0n);
    console.log(`${model.name.padEnd(24)} ${rows.length}`);
  }
  counters.StoredFile = nextFileId - 1n;
  console.log(`${"StoredFile".padEnd(24)} ${storedFiles.size}`);

  // Next id handed out per model = max imported id + 1.
  for (const [model, maxId] of Object.entries(counters)) {
    await prisma.$runCommandRaw({
      update: "counters",
      updates: [{ q: { _id: model }, u: { $set: { seq: Number(maxId) } }, upsert: true }],
    });
  }

  for (const [collection, indexes] of Object.entries(INDEXES)) {
    await prisma.$runCommandRaw({
      createIndexes: collection,
      indexes: indexes.map((index) => ({
        key: index.key,
        name: Object.keys(index.key).join("_") + (index.unique ? "_unique" : "_idx"),
        ...(index.unique ? { unique: true } : {}),
        ...(index.partial ? { partialFilterExpression: index.partial } : {}),
      })) as Prisma.InputJsonArray,
    });
  }
  console.log("Counters and indexes created.");

  const skipped = Object.keys(dump).filter((t) => !handledTables.has(t));
  if (skipped.length > 0) {
    console.log(`Skipped tables with no model in schema.prisma: ${skipped.join(", ")}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
