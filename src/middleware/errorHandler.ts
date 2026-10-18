import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { message: "Validation failed", code: "VALIDATION_ERROR", issues: err.issues },
    });
    return;
  }

  // e.g. LIMIT_FILE_SIZE — the client sent a bad upload, not a server fault.
  if (err instanceof MulterError) {
    res.status(400).json({ error: { message: err.message, code: err.code } });
    return;
  }

  // MongoDB has no foreign keys, so Prisma enforces relations itself and
  // rejects deleting a record others still point to (P2014); P2002 is a
  // unique-index clash (e.g. a duplicate category name). Both are the
  // caller's conflict to resolve, not a server fault.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2014" || err.code === "P2003") {
      res.status(409).json({
        error: { message: "This record is still in use by other records and can't be deleted", code: "IN_USE" },
      });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({ error: { message: "A record with this value already exists", code: "DUPLICATE" } });
      return;
    }
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }

  console.error(err);
  res.status(500).json({ error: { message: "Internal server error", code: "INTERNAL_ERROR" } });
};
