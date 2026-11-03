import { CONSOLE_REQUEST_IMAGE_MAX_BYTES } from '@fmip/contracts/console';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_REFUSALS,
  checkCaption,
  checkUpload,
  processUpload,
  sniffUpload,
} from './request-images';

/**
 * Pictures on the teammate requests (T-1731, D-357): the first bytes decide
 * the type, the decoder must agree, and what is stored is a WebP with no
 * metadata, the long side at most 2400 px, plus a 480 px thumbnail.
 */

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } } });

/** A phone photo: JPEG with EXIF, a GPS position and an orientation that turns it. */
async function phoneJpeg(): Promise<Buffer> {
  return solid(400, 200)
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'T-1731' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '35/1 41/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '51/1 25/1 0/1',
      },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

describe('sniffUpload', () => {
  it('reads the type from the first bytes', async () => {
    expect(sniffUpload(await solid(4, 4).png().toBuffer())).toEqual({
      kind: 'ok',
      type: 'image/png',
    });
    expect(sniffUpload(await solid(4, 4).jpeg().toBuffer())).toEqual({
      kind: 'ok',
      type: 'image/jpeg',
    });
    expect(sniffUpload(await solid(4, 4).webp().toBuffer())).toEqual({
      kind: 'ok',
      type: 'image/webp',
    });
    expect(sniffUpload(await solid(4, 4).gif().toBuffer())).toEqual({
      kind: 'ok',
      type: 'image/gif',
    });
  });

  it('knows a HEIC by its brand, and nothing else by its name', () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16),
    ]);
    expect(sniffUpload(heic)).toEqual({ kind: 'heic' });
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypavif'),
      Buffer.alloc(16),
    ]);
    expect(sniffUpload(avif)).toEqual({ kind: 'unknown' });
    expect(sniffUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
      kind: 'unknown',
    });
    expect(sniffUpload(Buffer.from('%PDF-1.7'))).toEqual({ kind: 'unknown' });
  });
});

describe('checkUpload', () => {
  it('refuses empty, over 8 MB, HEIC and other types, with their sentences', () => {
    expect(checkUpload(Buffer.alloc(0))).toEqual({ ok: false, reason: IMAGE_REFUSALS.empty });
    const big = Buffer.alloc(CONSOLE_REQUEST_IMAGE_MAX_BYTES + 1);
    Buffer.from([0xff, 0xd8, 0xff]).copy(big);
    expect(checkUpload(big)).toEqual({ ok: false, reason: IMAGE_REFUSALS.tooBig });
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheix'),
      Buffer.alloc(8),
    ]);
    expect(checkUpload(heic)).toEqual({ ok: false, reason: IMAGE_REFUSALS.heic });
    expect(checkUpload(Buffer.from('GIF8 not quite'))).toEqual({
      ok: false,
      reason: IMAGE_REFUSALS.type,
    });
  });

  it('takes exactly 8 MB', () => {
    const edge = Buffer.alloc(CONSOLE_REQUEST_IMAGE_MAX_BYTES);
    Buffer.from([0xff, 0xd8, 0xff]).copy(edge);
    expect(checkUpload(edge)).toEqual({ ok: true, value: 'image/jpeg' });
  });
});

describe('checkCaption', () => {
  it('trims, folds lines, and treats empty as none', () => {
    expect(checkCaption(undefined)).toEqual({ ok: true, value: null });
    expect(checkCaption('   ')).toEqual({ ok: true, value: null });
    expect(checkCaption(' صفحه‌ی بازی\nروی گوشی ')).toEqual({
      ok: true,
      value: 'صفحه‌ی بازی روی گوشی',
    });
  });

  it('counts characters, not code units, up to 300', () => {
    expect(checkCaption('⚽'.repeat(300)).ok).toBe(true);
    expect(checkCaption('ب'.repeat(301)).ok).toBe(false);
    expect(checkCaption(42).ok).toBe(false);
  });
});

describe('processUpload', () => {
  it('strips EXIF and GPS from a phone photo and applies its orientation', async () => {
    const input = await phoneJpeg();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);
    expect(input.includes(Buffer.from('TestPhone'))).toBe(true);

    const out = await processUpload(input, 'image/jpeg');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { full, thumb } = out.value;
    for (const file of [full, thumb]) {
      const meta = await sharp(file.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(file.bytes.includes(Buffer.from('Exif'))).toBe(false);
      expect(file.bytes.includes(Buffer.from('TestPhone'))).toBe(false);
      expect(file.bytes.includes(Buffer.from('GPS'))).toBe(false);
    }
    // Orientation 6 is a quarter turn: the 400x200 photo stands as 200x400.
    expect([full.width, full.height]).toEqual([200, 400]);
    expect(full.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fits the long side within 2400 px and the thumbnail within 480 px, never enlarging', async () => {
    const wide = await processUpload(await solid(3000, 1000).png().toBuffer(), 'image/png');
    expect(wide.ok && [wide.value.full.width, wide.value.full.height]).toEqual([2400, 800]);
    expect(wide.ok && [wide.value.thumb.width, wide.value.thumb.height]).toEqual([480, 160]);
    const small = await processUpload(await solid(120, 90).webp().toBuffer(), 'image/webp');
    expect(small.ok && [small.value.full.width, small.value.thumb.width]).toEqual([120, 120]);
  });

  it('keeps the first frame of a GIF', async () => {
    const gif = await processUpload(await solid(60, 40).gif().toBuffer(), 'image/gif');
    expect(gif.ok).toBe(true);
    if (gif.ok) expect((await sharp(gif.value.full.bytes).metadata()).pages ?? 1).toBe(1);
  });

  it('refuses bytes the decoder reads as another type, and bytes it cannot read', async () => {
    const png = await solid(8, 8).png().toBuffer();
    expect(await processUpload(png, 'image/jpeg')).toEqual({
      ok: false,
      reason: IMAGE_REFUSALS.unreadable,
    });
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    expect(await processUpload(broken, 'image/jpeg')).toEqual({
      ok: false,
      reason: IMAGE_REFUSALS.unreadable,
    });
  });

  it('refuses a picture of more than 50 million pixels', async () => {
    const bomb = await sharp({
      create: { width: 10_000, height: 6_000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(await processUpload(bomb, 'image/png')).toEqual({
      ok: false,
      reason: IMAGE_REFUSALS.tooManyPixels,
    });
  });
});
