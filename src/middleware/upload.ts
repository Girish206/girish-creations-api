import multer from "multer";
import { compressImage } from "../lib/compressImage";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

// Vercel rejects any request body over 4.5MB before it reaches this code
// (and a MongoDB document is capped at 16MB, as uploads are stored inline in
// one — see uploadFile below), so cap files at 4MB to leave room for the
// rest of the multipart form and fail with a clear 4xx instead.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Buffers the file in memory; uploadFile then writes the bytes into the
// "files" collection, so no local disk (or external blob store) is involved.
// Raster images and PDFs (a portfolio's resume) only. SVG, HTML and the like
// could carry script, and files are served from the sites' own domains.
export const UPLOAD_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "application/pdf"]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, accept) => {
    if (UPLOAD_TYPES.has(file.mimetype.toLowerCase())) return accept(null, true);
    accept(new HttpError(400, "Upload a JPEG, PNG, WebP or GIF image (or a PDF)", "UNSUPPORTED_FILE"));
  },
});

export const FILE_URL_PREFIX = "/api/files/";

// Stores a multer-buffered file in the database and returns the path it's
// served from (GET /api/files/:id) — that path is what gets saved on the
// referencing record (profile picture, signature, project image).
// Images are compressed first (see lib/compressImage).
export async function uploadFile(file: Express.Multer.File): Promise<string> {
  const compressed = await compressImage(file.buffer, file.mimetype, file.originalname);
  const stored = await prisma.storedFile.create({
    data: {
      filename: compressed?.filename ?? file.originalname,
      contentType: compressed?.contentType ?? file.mimetype,
      size: compressed?.size ?? file.size,
      data: new Uint8Array(compressed?.data ?? file.buffer),
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
