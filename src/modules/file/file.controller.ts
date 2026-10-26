import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { parseId } from "../../utils/parseId";
import { NotFoundError } from "../../utils/httpError";
import { UPLOAD_TYPES } from "../../middleware/upload";

export async function getFileHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) {
    throw NotFoundError("File not found");
  }

  // Files made before uploads were limited to images and PDFs could be
  // anything: those download instead of opening. None of them may run
  // script (nosniff, and a sandbox for anything shown as a page).
  const safe = UPLOAD_TYPES.has(file.contentType.toLowerCase());
  res.set({
    "Content-Type": safe ? file.contentType : "application/octet-stream",
    ...(safe ? {} : { "Content-Disposition": "attachment" }),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Content-Length": String(file.size),
    // Ids are never reused — a replaced image gets a new id/URL — so the
    // browser (and any CDN in front) can cache each one forever.
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(Buffer.from(file.data));
}
