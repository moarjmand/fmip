/**
 * Pictures on the teammate requests (T-1731, D-357): what an upload may be,
 * and the re-encoding that makes the stored file.
 *
 * An upload is trusted for nothing. Its first bytes decide what it is (never
 * its name or the type the browser said); the decoder must agree with them;
 * and what is stored is a new WebP drawn from the decoded pixels, with no
 * metadata at all: sharp writes none unless asked to, so the EXIF block (and
 * any GPS position in it), XMP, IPTC and the ICC profile are left behind. The
 * orientation the EXIF said is applied to the pixels first, so a phone photo
 * stands the right way up without it.
 */

import { createHash } from 'node:crypto';
import {
  CONSOLE_REQUEST_IMAGE_CAPTION_MAX,
  CONSOLE_REQUEST_IMAGE_LONG_SIDE,
  CONSOLE_REQUEST_IMAGE_MAX_BYTES,
  CONSOLE_REQUEST_IMAGE_THUMB_SIDE,
} from '@fmip/contracts/console';
import sharp, { type Sharp } from 'sharp';
import { cleanText } from './console-rules';

/** The `rate_limit` row of a console person's uploads. */
export const IMAGE_CEILING = 'console_request_image';
export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The stored file's type, and its thumbnail's. */
export const STORED_TYPE = 'image/webp';

/**
 * The most pixels a decoded upload may have: about a 48-megapixel phone
 * photo. A small file that decodes to far more is a decompression bomb.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** WebP quality of the stored picture and of the thumbnail: text in a screenshot stays sharp. */
export const FULL_QUALITY = 86;
export const THUMB_QUALITY = 76;

export type UploadType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export type Sniffed = { kind: 'ok'; type: UploadType } | { kind: 'heic' } | { kind: 'unknown' };

/** HEIF brands of a HEVC-coded picture (an iPhone's `.heic`); AVIF is not among them. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const ascii = (bytes: Buffer, start: number, end: number): string =>
  bytes.subarray(start, end).toString('latin1');

/** What the first bytes say the file is; never the name or the stated type. */
export function sniffUpload(bytes: Buffer): Sniffed {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return { kind: 'ok', type: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { kind: 'ok', type: 'image/jpeg' };
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6)))
    return { kind: 'ok', type: 'image/gif' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return { kind: 'ok', type: 'image/webp' };
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12)))
    return { kind: 'heic' };
  return { kind: 'unknown' };
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** sharp's name for each accepted type: the decoder must agree with the first bytes. */
const DECODER_FORMAT: Record<UploadType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The refusals, as sentences the console words in Persian (`app/console/words.ts`). */
export const IMAGE_REFUSALS = {
  empty: 'The picture is empty.',
  tooBig: `A picture is at most ${CONSOLE_REQUEST_IMAGE_MAX_BYTES / 1024 / 1024} MB.`,
  heic: 'HEIC pictures cannot be read here. Send a screenshot or a JPEG instead.',
  type: 'Only PNG, JPEG, WebP and GIF pictures are accepted.',
  unreadable: 'The picture could not be read.',
  tooManyPixels: 'The picture has too many pixels.',
} as const;

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

/** An upload's bytes, before decoding: not empty, not over the cap, a type we take. */
export function checkUpload(bytes: Buffer): Checked<UploadType> {
  if (bytes.length === 0) return { ok: false, reason: IMAGE_REFUSALS.empty };
  if (bytes.length > CONSOLE_REQUEST_IMAGE_MAX_BYTES)
    return { ok: false, reason: IMAGE_REFUSALS.tooBig };
  const sniffed = sniffUpload(bytes);
  if (sniffed.kind === 'heic') return { ok: false, reason: IMAGE_REFUSALS.heic };
  if (sniffed.kind === 'unknown') return { ok: false, reason: IMAGE_REFUSALS.type };
  return { ok: true, value: sniffed.type };
}

/** A caption: trimmed, at most 300 characters; `''` or none is no caption. */
export function checkCaption(value: unknown): Checked<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, reason: 'A caption is text.' };
  const text = cleanText(value).replace(/\n+/g, ' ').trim();
  if ([...text].length > CONSOLE_REQUEST_IMAGE_CAPTION_MAX)
    return {
      ok: false,
      reason: `A caption is at most ${CONSOLE_REQUEST_IMAGE_CAPTION_MAX} characters.`,
    };
  return { ok: true, value: text === '' ? null : text };
}

export interface EncodedImage {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export interface ProcessedImage {
  full: EncodedImage;
  thumb: EncodedImage;
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

// One picture at a time in this process, like the media module's variants:
// the server has two cores that also serve every page.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Decodes an upload whose first bytes said `type` and writes the stored
 * picture (long side at most 2400 px, never enlarged) and its thumbnail (480
 * px), both WebP without metadata. A GIF gives its first frame. Refuses what
 * the decoder cannot read, what it reads as another format than the first
 * bytes said, and what has too many pixels.
 */
export function processUpload(bytes: Buffer, type: UploadType): Promise<Checked<ProcessedImage>> {
  return oneAtATime(async () => {
    const input = (): Sharp =>
      sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', pages: 1 });
    let format: string | undefined;
    let pixels: number;
    try {
      const meta = await input().metadata();
      format = meta.format;
      pixels = (meta.width ?? 0) * (meta.height ?? 0);
    } catch (error) {
      return {
        ok: false,
        reason: /pixel limit/i.test(String(error))
          ? IMAGE_REFUSALS.tooManyPixels
          : IMAGE_REFUSALS.unreadable,
      };
    }
    if (format !== DECODER_FORMAT[type] || pixels <= 0)
      return { ok: false, reason: IMAGE_REFUSALS.unreadable };
    if (pixels > MAX_INPUT_PIXELS) return { ok: false, reason: IMAGE_REFUSALS.tooManyPixels };
    try {
      const full = await input()
        .rotate()
        .resize({
          width: CONSOLE_REQUEST_IMAGE_LONG_SIDE,
          height: CONSOLE_REQUEST_IMAGE_LONG_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: FULL_QUALITY, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(full.data)
        .resize({
          width: CONSOLE_REQUEST_IMAGE_THUMB_SIDE,
          height: CONSOLE_REQUEST_IMAGE_THUMB_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: THUMB_QUALITY, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      return {
        ok: true,
        value: {
          full: {
            bytes: full.data,
            width: full.info.width,
            height: full.info.height,
            sha256: sha256(full.data),
          },
          thumb: {
            bytes: thumb.data,
            width: thumb.info.width,
            height: thumb.info.height,
            sha256: sha256(thumb.data),
          },
        },
      };
    } catch {
      return { ok: false, reason: IMAGE_REFUSALS.unreadable };
    }
  });
}
