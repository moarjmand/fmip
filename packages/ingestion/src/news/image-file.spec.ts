import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, sniffImage } from './image-file';

/** Minimal headers of each accepted format, built byte by byte (T-1322). */
function jpegOf(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...Array.from('JFIF\0', (c) => c.charCodeAt(0)),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

function pngOf(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(
    Array.from('IHDR', (c) => c.charCodeAt(0)),
    12,
  );
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function webpOf(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set(
    Array.from('RIFF', (c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    Array.from('WEBPVP8X', (c) => c.charCodeAt(0)),
    8,
  );
  const w = width - 1;
  const h = height - 1;
  b.set(
    [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
    24,
  );
  return b;
}

describe('sniffImage', () => {
  it('reads JPEG, PNG and WebP sizes from their headers', () => {
    expect(sniffImage(jpegOf(600, 400))).toEqual({
      ok: true,
      image: { contentType: 'image/jpeg', extension: 'jpg', width: 600, height: 400 },
    });
    expect(sniffImage(pngOf(800, 450))).toEqual({
      ok: true,
      image: { contentType: 'image/png', extension: 'png', width: 800, height: 450 },
    });
    expect(sniffImage(webpOf(1200, 675))).toEqual({
      ok: true,
      image: { contentType: 'image/webp', extension: 'webp', width: 1200, height: 675 },
    });
  });

  it('refuses what is not a photo we keep', () => {
    const html = new TextEncoder().encode('<html>not found</html>');
    expect(sniffImage(html)).toEqual({ ok: false, reason: 'not a JPEG, PNG or WebP file' });
    expect(sniffImage(new Uint8Array())).toMatchObject({ ok: false });
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toMatchObject({ ok: false });
    expect(sniffImage(jpegOf(64, 64))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('too small'),
    });
    expect(sniffImage(jpegOf(9000, 400))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('larger'),
    });
    expect(sniffImage(new Uint8Array(IMAGE_MAX_BYTES + 1))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('over'),
    });
  });
});
