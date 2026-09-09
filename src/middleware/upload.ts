import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env";

const uploadsRoot = path.resolve(env.uploadsDir);

const FIELD_SUBFOLDERS: Record<string, string> = {
  profilePicture: "profile_pictures",
  signature: "signatures",
  image: "project_images",
};

function subfolderFor(fieldname: string): string {
  return FIELD_SUBFOLDERS[fieldname] ?? "misc";
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, subfolderFor(file.fieldname));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

export const upload = multer({ storage });

// Relative path (as stored in the DB, e.g. "profile_pictures/foo-123.png") for an
// uploaded file, derived from the multer field name that received it.
export function relativeUploadPath(file: Express.Multer.File) {
  return path.posix.join(subfolderFor(file.fieldname), file.filename);
}
