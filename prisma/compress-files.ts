// One-off: recompresses images uploaded before upload-time compression
// existed (see src/lib/compressImage.ts). Each file keeps its id, so every
// /api/files/:id URL saved on profiles, projects and tournaments still works.
//
//   npm run compress:files            — dry run: reports the savings only
//   npm run compress:files -- --apply — writes the smaller versions back
//
// The database has no backups, so run the dry run first.
import { PrismaClient } from "@prisma/client";
import { compressImage } from "../src/lib/compressImage";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  // Only the small fields up front; each file's bytes are loaded one at a
  // time below so the whole collection never sits in memory at once.
  const files = await prisma.storedFile.findMany({
    select: { id: true, filename: true, contentType: true, size: true },
    orderBy: { id: "asc" },
  });
  console.log(`${files.length} files${apply ? "" : " (dry run — nothing is written)"}\n`);

  let before = 0;
  let after = 0;
  let changed = 0;
  for (const meta of files) {
    before += meta.size;
    const file = await prisma.storedFile.findUnique({ where: { id: meta.id } });
    if (!file) continue;

    const compressed = await compressImage(Buffer.from(file.data), file.contentType, file.filename);
    if (!compressed) {
      after += file.size;
      continue;
    }

    after += compressed.size;
    changed++;
    console.log(`#${file.id} ${file.filename}: ${kb(file.size)} -> ${kb(compressed.size)}`);
    if (apply) {
      await prisma.storedFile.update({
        where: { id: file.id },
        data: {
          filename: compressed.filename,
          contentType: compressed.contentType,
          size: compressed.size,
          data: new Uint8Array(compressed.data),
        },
      });
    }
  }

  console.log(`\n${changed} of ${files.length} files ${apply ? "recompressed" : "would be recompressed"}`);
  console.log(`Total: ${kb(before)} -> ${kb(after)} (saves ${kb(before - after)})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
