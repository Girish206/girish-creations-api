import type { Request, Response } from "express";
import { z } from "zod";
import * as profileService from "./profile.service";
import { BadRequestError } from "../../utils/httpError";
import { uploadFile } from "../../middleware/upload";
import { scopedProfileId } from "../../middleware/portfolioScope";

export async function listPortfoliosHandler(_req: Request, res: Response) {
  const portfolios = await profileService.listPortfolios();
  res.json({ data: portfolios });
}

export async function listManageablePortfoliosHandler(_req: Request, res: Response) {
  const accounts = await profileService.listManageablePortfolios();
  res.json({ data: accounts });
}

export async function getProfileHandler(req: Request, res: Response) {
  const profile = await profileService.getProfile(scopedProfileId(req));
  // A hidden phone number never leaves the server for visitors; the owner
  // still gets it to edit.
  if (req.portfolioIsPublic && profile.showContactNumber === false) {
    profile.contactNumber = null;
  }
  res.json({ data: profile });
}

const updateProfileSchema = z.object({
  username: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  bio: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  // "true" / "false" — multipart form data sends every field as a string.
  showContactNumber: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  address: z.string().nullable().optional(),
  facebookId: z.string().nullable().optional(),
  instaId: z.string().nullable().optional(),
  linkedinId: z.string().nullable().optional(),
  twitterId: z.string().nullable().optional(),
  portfolioStyle: z.enum(profileService.PORTFOLIO_STYLES).optional(),
  portfolioAccent: z.enum(profileService.PORTFOLIO_ACCENTS).optional(),
  // Sent as the string "true" from multipart form data. Ignored if a new
  // signature file is uploaded in the same request â€” the upload wins.
  removeSignature: z.string().optional(),
  // Same convention as removeSignature, for the résumé PDF.
  removeResume: z.string().optional(),
});

export async function updateProfileHandler(req: Request, res: Response) {
  const { removeSignature, removeResume, ...data } = updateProfileSchema.parse(req.body);
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};

  const profilePictureFile = files.profilePicture?.[0];
  const signatureFile = files.signature?.[0];
  const resumeFile = files.resume?.[0];
  if (resumeFile && resumeFile.mimetype !== "application/pdf") {
    throw BadRequestError("Résumé must be a PDF");
  }

  const profile = await profileService.updateProfile(scopedProfileId(req), {
    ...data,
    ...(profilePictureFile ? { profilePicture: await uploadFile(profilePictureFile) } : {}),
    ...(signatureFile
      ? { signature: await uploadFile(signatureFile) }
      : removeSignature === "true"
        ? { signature: null }
        : {}),
    ...(resumeFile
      ? { resume: await uploadFile(resumeFile) }
      : removeResume === "true"
        ? { resume: null }
        : {}),
  });

  res.json({ data: profile });
}
