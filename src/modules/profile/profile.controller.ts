import type { Request, Response } from "express";
import { z } from "zod";
import * as profileService from "./profile.service";
import { relativeUploadPath } from "../../middleware/upload";

export async function getProfileHandler(_req: Request, res: Response) {
  const profile = await profileService.getProfile();
  res.json({ data: profile });
}

const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  bio: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  facebookId: z.string().nullable().optional(),
  instaId: z.string().nullable().optional(),
  linkedinId: z.string().nullable().optional(),
  twitterId: z.string().nullable().optional(),
  // Sent as the string "true" from multipart form data. Ignored if a new
  // signature file is uploaded in the same request — the upload wins.
  removeSignature: z.string().optional(),
});

export async function updateProfileHandler(req: Request, res: Response) {
  const { removeSignature, ...data } = updateProfileSchema.parse(req.body);
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};

  const profilePictureFile = files.profilePicture?.[0];
  const signatureFile = files.signature?.[0];

  const profile = await profileService.updateProfile({
    ...data,
    ...(profilePictureFile ? { profilePicture: relativeUploadPath(profilePictureFile) } : {}),
    ...(signatureFile
      ? { signature: relativeUploadPath(signatureFile) }
      : removeSignature === "true"
        ? { signature: null }
        : {}),
  });

  res.json({ data: profile });
}
