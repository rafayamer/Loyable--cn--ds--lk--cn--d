// ================================================================
//  image-compress.util.ts
//  Compress an image buffer under a target size (default 1 MB) WITHOUT
//  reducing its pixel dimensions (resolution preserved). Works by
//  re-encoding at progressively lower quality, and falling back to WebP
//  which is far smaller at the same dimensions. Uses sharp.
//
//  PDFs and other non-image files cannot be re-encoded this way and are
//  returned unchanged — the caller enforces the size limit for those.
// ================================================================

import sharp from 'sharp';

const ONE_MB = 1024 * 1024;

export interface CompressResult { buffer: Buffer; ext: string; mime: string; compressed: boolean; bytes: number; }

const isImageExt = (ext: string) => ['.jpg', '.jpeg', '.png', '.webp'].includes(ext.toLowerCase());

/**
 * Returns a buffer guaranteed (best-effort) to be <= maxBytes for images,
 * keeping the original width/height. Throws if a non-image exceeds maxBytes.
 */
export const compressUnder = async (
  input: Buffer,
  ext: string,
  maxBytes = ONE_MB,
): Promise<CompressResult> => {
  // Non-images (e.g. PDF): can't re-encode losslessly here — enforce the limit.
  if (!isImageExt(ext)) {
    if (input.length > maxBytes) {
      throw new Error(`FILE_TOO_LARGE: ${ext} files must be under ${Math.round(maxBytes / 1024)}KB`);
    }
    return { buffer: input, ext: ext.toLowerCase(), mime: ext.toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream', compressed: false, bytes: input.length };
  }

  // Already small enough → keep as-is.
  if (input.length <= maxBytes) {
    return { buffer: input, ext: ext.toLowerCase(), mime: `image/${ext.replace('.', '')}`, compressed: false, bytes: input.length };
  }

  const base = sharp(input, { failOn: 'none' }).rotate(); // honor EXIF orientation, keep dimensions

  // Try JPEG at decreasing quality first (no dimension change).
  for (const q of [85, 75, 65, 55, 45]) {
    const out = await base.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (out.length <= maxBytes) return { buffer: out, ext: '.jpg', mime: 'image/jpeg', compressed: true, bytes: out.length };
  }
  // Fall back to WebP (smaller at equal resolution).
  for (const q of [80, 70, 60, 50, 40, 30]) {
    const out = await base.clone().webp({ quality: q }).toBuffer();
    if (out.length <= maxBytes) return { buffer: out, ext: '.webp', mime: 'image/webp', compressed: true, bytes: out.length };
  }
  // Last resort: lowest WebP quality (still full resolution).
  const final = await base.clone().webp({ quality: 25 }).toBuffer();
  return { buffer: final, ext: '.webp', mime: 'image/webp', compressed: true, bytes: final.length };
};
