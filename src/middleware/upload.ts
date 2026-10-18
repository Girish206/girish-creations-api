import multer from "multer";
import { prisma } from "../lib/prisma";

// Vercel rejects any request body over 4.5MB before it reaches this code
// (and a MongoDB document is capped at 16MB, as uploads are stored inline in
// one — see uploadFile below), so cap files at 4MB to leave room for the
// rest of the multipart form and fail with a clear 4xx instead.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Buffers the file in memory; uploadFile then writes the bytes into the
// "files" collection, so no local disk (or external blob store) is involved.
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

export const FILE_URL_PREFIX = "/api/files/";

// Stores a multer-buffered file in the database and returns the path it's
// served from (GET /api/files/:id) — that path is what gets saved on the
// referencing record (profile picture, signature, project image).
export async function uploadFile(file: Express.Multer.File): Promise<string> {
  const stored = await prisma.storedFile.create({
    data: {
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      data: new Uint8Array(file.buffer),
    },
    select: { id: true },
  });
  return `${FILE_URL_PREFIX}${stored.id}`;
}

// Removes a previously uploaded file once nothing references it anymore
// (image replaced, signature removed, project deleted), so the DB doesn't
// accumulate orphaned binaries. Ignores anything that isn't one of ours.
export async function deleteUploadedFile(url: string | null | undefined) {
  if (!url?.startsWith(FILE_URL_PREFIX)) return;
  const rawId = url.slice(FILE_URL_PREFIX.length);
  if (!/^\d+$/.test(rawId)) return;
  await prisma.storedFile.deleteMany({ where: { id: BigInt(rawId) } });
}
