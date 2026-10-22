/**
 * A stored crest, logo or photo at a smaller width, as WebP (T-1462, D-242).
 *
 * The provider's files are drawn at 18 to 96 CSS pixels and arrive as PNGs of
 * 150 pixels or more: 60-160 kB each, 1.66 MB on the homepage on 2026-10-21.
 * A variant is the image fitted inside a square of `width` (never enlarged:
 * a small original keeps its own size), encoded as WebP, transparency kept.
 * Made once per original and width (`MediaFiles.variant`), so the cost is
 * paid on the first view after a crest changes, not on every one.
 */

import sharp from 'sharp';

// One image at a time, and no cache in memory: the VPS has two cores that
// also serve every page, and each original is read once per width anyway.
sharp.concurrency(1);
sharp.cache(false);

/** WebP at this quality is indistinguishable from the PNG at a crest's size. */
export const VARIANT_QUALITY = 80;

export async function webpVariant(bytes: Buffer, width: number): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: 4096 * 4096 })
    .rotate()
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: VARIANT_QUALITY, effort: 4 })
    .toBuffer();
}
