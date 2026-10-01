/**
 * What a downloaded image is allowed to be (T-1320, D-176). Pure, so the rules
 * are argued with in `image-check.spec.ts` rather than against a provider.
 *
 * An image is kept only when the provider's content type and the file's own
 * first bytes agree on one of four formats, and it is at most `MAX_BYTES`. An
 * SVG is also refused when it could run anything: it is served from our own
 * origin, and a script there would run as the site.
 */

import { createHash } from 'node:crypto';

export const MEDIA_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

/** A crest or a photo is a few kilobytes; anything past this is not one. */
export const MAX_BYTES = 512 * 1024;

export const EXTENSION: Record<MediaContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

/**
 * The provider's generic silhouette for a player it has no photo of, by
 * sha256. API-Football serves an image for every player id, and for a player
 * without a photo that image is the same silhouette; storing it would show a
 * reader a stranger's outline as if it were the player. Measured values go
 * here; `PLACEHOLDER_REPEATS` catches the silhouette without one.
 */
export const KNOWN_PLACEHOLDER_SHA256: ReadonlySet<string> = new Set<string>([]);

/**
 * How many different people may share one photo, byte for byte, before that
 * photo is taken for the provider's placeholder. Two players never share a
 * real photo; the silhouette is shared by thousands.
 */
export const PLACEHOLDER_REPEATS = 3;

export type ImageVerdict =
  | {
      kind: 'image';
      contentType: MediaContentType;
      bytes: Buffer;
      byteSize: number;
      sha256: string;
    }
  /** The provider has no image for this entity: a 404, or its silhouette. */
  | { kind: 'not_supplied'; reason: string }
  /** Something went wrong that a later attempt may not repeat. */
  | { kind: 'failed'; reason: string };

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The declared type without parameters, lower case: `image/png; x=y` -> `image/png`. */
function declared(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

/** What the first bytes say the file is, or `null`. */
export function sniff(bytes: Buffer): MediaContentType | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const head = bytes.subarray(0, 1024).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return 'image/svg+xml';
  }
  return null;
}

/**
 * An SVG that could act rather than be drawn: a script, an event handler, a
 * foreign object, or a reference that leaves the file. Refused whole; a
 * cleaned copy would be our drawing, not theirs.
 */
export function unsafeSvg(text: string): string | null {
  if (/<script[\s>]/i.test(text)) return 'svg carries a script';
  if (/\son[a-z]+\s*=/i.test(text)) return 'svg carries an event handler';
  if (/<foreignObject[\s>]/i.test(text)) return 'svg carries a foreign object';
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(text)) return 'svg refers outside itself';
  if (/url\(\s*["']?\s*(?!#)/i.test(text)) return 'svg refers outside itself';
  if (/<!ENTITY/i.test(text)) return 'svg declares an entity';
  return null;
}

/**
 * The verdict on one response. `status` and `contentType` are the provider's;
 * `bytes` is the body, read up to one byte past `MAX_BYTES` by the caller so a
 * larger file is known to be larger without being read whole.
 */
export function assessImage(
  status: number,
  contentType: string | null,
  bytes: Buffer,
  placeholders: ReadonlySet<string> = KNOWN_PLACEHOLDER_SHA256,
): ImageVerdict {
  if (status === 404 || status === 410) return { kind: 'not_supplied', reason: `http ${status}` };
  if (status !== 200) return { kind: 'failed', reason: `http ${status}` };
  if (bytes.length === 0) return { kind: 'failed', reason: 'empty body' };
  if (bytes.length > MAX_BYTES) return { kind: 'failed', reason: `larger than ${MAX_BYTES} bytes` };
  const type = declared(contentType);
  if (!(MEDIA_CONTENT_TYPES as readonly string[]).includes(type)) {
    return { kind: 'failed', reason: `content type ${type || 'missing'}` };
  }
  const actual = sniff(bytes);
  if (actual !== type) {
    return { kind: 'failed', reason: `declared ${type}, reads as ${actual ?? 'unknown'}` };
  }
  if (actual === 'image/svg+xml') {
    const unsafe = unsafeSvg(bytes.toString('utf8'));
    if (unsafe !== null) return { kind: 'failed', reason: unsafe };
  }
  const sha256 = sha256Of(bytes);
  if (placeholders.has(sha256)) return { kind: 'not_supplied', reason: 'provider placeholder' };
  return { kind: 'image', contentType: actual, bytes, byteSize: bytes.length, sha256 };
}

/** Where a file lives under the media directory: sharded by the hash's first two characters. */
export function storageKey(sha256: string, contentType: MediaContentType): string {
  return `${sha256.slice(0, 2)}/${sha256}.${EXTENSION[contentType]}`;
}

/** The address's version: short, and changes when the file does. */
export function versionOf(sha256: string): string {
  return sha256.slice(0, 12);
}
