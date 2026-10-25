import sharp from "sharp";

// Uploads are stored inline in MongoDB (see middleware/upload.ts) and every
// view of one is a serverless function call, so each byte saved here makes
// pages load faster and keeps the free-tier database from filling up.
//
// Images are re-encoded as WebP at a quality high enough that the result
// looks the same as the original, and scaled down only when they're larger
// than anything the sites display. If that doesn't make a file meaningfully
// smaller, the original bytes are kept untouched.

export interface CompressedImage {
  data: Buffer;
  contentType: string;
  filename: string;
  size: number;
}

// Longest side in pixels — above full-screen size on a 2x display.
const MAX_DIMENSION = 2048;
// WebP quality for photos; visually indistinguishable from the source.
const PHOTO_QUALITY = 85;
// PNGs (logos, icons, screenshots) go lossless first, so sharp edges and
// transparency survive exactly; only a lossless result this big falls back
// to near-transparent lossy encoding.
const LOSSLESS_MAX_BYTES = 300 * 1024;
const GRAPHIC_QUALITY = 92;
// Keep the original unless the new file is at least 10% smaller — not worth
// a re-encode (and its tiny generational loss) for less.
const MIN_SAVING = 0.9;

// GIFs may be animated and SVGs are vectors; PDFs etc. aren't images at all.
const COMPRESSIBLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function isCompressible(contentType: string) {
  return COMPRESSIBLE.has(contentType.toLowerCase());
}

export async function compressImage(
  buffer: Buffer,
  contentType: string,
  filename: string,
): Promise<CompressedImage | null> {
  if (!isCompressible(contentType)) return null;

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return null; // Corrupt or mislabelled — store it as it came.
  }
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  const oversized = Math.max(width, height) > MAX_DIMENSION;

  // A WebP within the size limit was already compressed (the client apps
  // encode before uploading); re-encoding it would only cost quality.
  if (meta.format === "webp" && !oversized) return null;

  // autoOrient bakes in the EXIF rotation, since metadata is stripped below.
  const pipeline = () =>
    sharp(buffer)
      .autoOrient()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });

  let data: Buffer;
  if (meta.format === "png") {
    data = await pipeline().webp({ lossless: true, effort: 6 }).toBuffer();
    if (data.length > LOSSLESS_MAX_BYTES) {
      data = await pipeline().webp({ quality: GRAPHIC_QUALITY, alphaQuality: 100, effort: 6 }).toBuffer();
    }
  } else {
    data = await pipeline().webp({ quality: PHOTO_QUALITY, smartSubsample: true, effort: 6 }).toBuffer();
  }

  if (!oversized && data.length > buffer.length * MIN_SAVING) return null;

  return {
    data,
    contentType: "image/webp",
    filename: filename.replace(/\.[^.]*$/, "") + ".webp",
    size: data.length,
  };
}
