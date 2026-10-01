/**
 * What a downloaded news photo is, read from its own bytes (T-1322, D-177).
 *
 * The publisher's `Content-Type` header is a claim; the file's first bytes
 * are the fact. A JPEG, PNG or WebP is accepted, its size read from its
 * header, and anything else -- an HTML error page served as `image/jpeg`, an
 * SVG, a GIF, a file too large or too small to be a photo -- is refused with
 * the reason. Nothing is decoded or resized: that would need an image
 * library in the API, which D-177 declines; the feeds already point at a
 * web-sized rendition.
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIN_SIDE = 120;
export const IMAGE_MAX_SIDE = 6000;

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface SniffedImage {
  contentType: ImageContentType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

export type SniffResult = { ok: true; image: SniffedImage } | { ok: false; reason: string };

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
function u32be(b: Uint8Array, i: number): number {
  return (
    (b[i] ?? 0) * 2 ** 24 + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))
  );
}
function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function u24le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
}
function ascii(b: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...b.subarray(from, from + length));
}

/** JPEG: walk the markers to the first start-of-frame. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** The image's type and size from its bytes, or why it is not one we keep. */
export function sniffImage(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: 'the file is empty' };
  if (bytes.length > IMAGE_MAX_BYTES) {
    return { ok: false, reason: `the file is over ${IMAGE_MAX_BYTES} bytes` };
  }
  let image: SniffedImage | null = null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    if (size !== null) image = { contentType: 'image/jpeg', extension: 'jpg', ...size };
  } else if (
    bytes.length >= 24 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[0] === 0x89 &&
    ascii(bytes, 12, 4) === 'IHDR'
  ) {
    image = {
      contentType: 'image/png',
      extension: 'png',
      width: u32be(bytes, 16),
      height: u32be(bytes, 20),
    };
  } else if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const size = webpSize(bytes);
    if (size !== null) image = { contentType: 'image/webp', extension: 'webp', ...size };
  } else {
    return { ok: false, reason: 'not a JPEG, PNG or WebP file' };
  }
  if (image === null) return { ok: false, reason: 'the image header could not be read' };
  const small = Math.min(image.width, image.height);
  const large = Math.max(image.width, image.height);
  if (small < IMAGE_MIN_SIDE) {
    return { ok: false, reason: `${image.width}x${image.height} is too small to be a photo` };
  }
  if (large > IMAGE_MAX_SIDE) {
    return { ok: false, reason: `${image.width}x${image.height} is larger than we keep` };
  }
  return { ok: true, image };
}
