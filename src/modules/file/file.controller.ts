import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { parseId } from "../../utils/parseId";
import { NotFoundError } from "../../utils/httpError";

export async function getFileHandler(req: Request, res: Response) {
  const id = parseId(req.params.id);
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) {
    throw NotFoundError("File not found");
  }

  res.set({
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    // Ids are never reused — a replaced image gets a new id/URL — so the
    // browser (and any CDN in front) can cache each one forever.
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  res.send(Buffer.from(file.data));
}
