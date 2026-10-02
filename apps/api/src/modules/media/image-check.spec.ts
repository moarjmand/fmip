import { describe, expect, it } from 'vitest';
import { allowedSource } from './media-fetch.service';
import {
  MAX_BYTES,
  assessImage,
  sha256Of,
  sniff,
  storageKey,
  unsafeSvg,
  versionOf,
} from './internal/image-check';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR a crest'),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="url(#g)"/></svg>',
);

describe('what a downloaded image may be (T-1320)', () => {
  it('keeps each of the four formats when the header and the bytes agree', () => {
    for (const [type, bytes] of [
      ['image/png', PNG],
      ['image/jpeg', JPEG],
      ['image/webp', WEBP],
      ['image/svg+xml', SVG],
    ] as const) {
      const verdict = assessImage(200, `${type}; charset=binary`, bytes, new Set());
      expect(verdict).toMatchObject({ kind: 'image', contentType: type, byteSize: bytes.length });
    }
  });

  it('refuses a type outside the four, an empty body and anything past the cap', () => {
    expect(assessImage(200, 'image/gif', PNG, new Set())).toMatchObject({ kind: 'failed' });
    expect(assessImage(200, 'text/html', Buffer.from('<html>'), new Set())).toMatchObject({
      kind: 'failed',
    });
    expect(assessImage(200, null, PNG, new Set())).toMatchObject({ kind: 'failed' });
    expect(assessImage(200, 'image/png', Buffer.alloc(0), new Set())).toMatchObject({
      kind: 'failed',
    });
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]);
    expect(assessImage(200, 'image/png', big, new Set())).toMatchObject({ kind: 'failed' });
  });

  it('stores a raster labelled as another raster under the type its bytes are (T-1345)', () => {
    // API-Football's player photos: `image/png`, JPEG bytes.
    expect(assessImage(200, 'image/png', JPEG, new Set())).toMatchObject({
      kind: 'image',
      contentType: 'image/jpeg',
    });
    expect(assessImage(200, 'image/png', WEBP, new Set())).toMatchObject({
      kind: 'image',
      contentType: 'image/webp',
    });
    const sha = sha256Of(JPEG);
    expect(storageKey(sha, 'image/jpeg')).toMatch(/\.jpg$/);
    // SVG on either side of a mismatch is still refused.
    expect(assessImage(200, 'image/svg+xml', PNG, new Set())).toMatchObject({ kind: 'failed' });
    expect(assessImage(200, 'image/png', SVG, new Set())).toMatchObject({
      kind: 'failed',
      reason: 'declared image/png, reads as image/svg+xml',
    });
    expect(assessImage(200, 'image/png', Buffer.from('not an image'), new Set())).toMatchObject({
      kind: 'failed',
    });
  });

  it('reads a 404 as the provider having no image, and any other status as a failure', () => {
    expect(assessImage(404, 'text/html', Buffer.from('no'), new Set())).toMatchObject({
      kind: 'not_supplied',
    });
    expect(assessImage(429, 'image/png', PNG, new Set())).toMatchObject({ kind: 'failed' });
    expect(assessImage(500, 'image/png', PNG, new Set())).toMatchObject({ kind: 'failed' });
  });

  it('tells a known placeholder apart from an image, by its hash', () => {
    const placeholders = new Set([sha256Of(PNG)]);
    expect(assessImage(200, 'image/png', PNG, placeholders)).toEqual({
      kind: 'not_supplied',
      reason: 'provider placeholder',
    });
  });

  it('refuses an SVG that could act rather than be drawn', () => {
    expect(unsafeSvg('<svg><script>alert(1)</script></svg>')).not.toBeNull();
    expect(unsafeSvg('<svg onload="x()"></svg>')).not.toBeNull();
    expect(unsafeSvg('<svg><foreignObject></foreignObject></svg>')).not.toBeNull();
    expect(unsafeSvg('<svg><image href="https://elsewhere/x.png"/></svg>')).not.toBeNull();
    expect(unsafeSvg('<svg><use xlink:href="#a"/></svg>')).toBeNull();
    const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    expect(assessImage(200, 'image/svg+xml', script, new Set())).toMatchObject({ kind: 'failed' });
  });

  it('sniffs nothing out of text that is not an image', () => {
    expect(sniff(Buffer.from('<html><svg></svg></html>'))).toBeNull();
    expect(sniff(Buffer.from('GIF89a'))).toBeNull();
  });

  it('names a file by its hash and versions an address by the hash too', () => {
    const sha = sha256Of(PNG);
    expect(storageKey(sha, 'image/png')).toBe(`${sha.slice(0, 2)}/${sha}.png`);
    expect(versionOf(sha)).toHaveLength(12);
  });

  it("follows only the provider's image host, over https", () => {
    expect(allowedSource('https://media.api-sports.io/football/teams/44.png')).toBe(true);
    expect(allowedSource('https://media-4.api-sports.io/football/players/1.png')).toBe(true);
    expect(allowedSource('http://media.api-sports.io/football/teams/44.png')).toBe(false);
    expect(allowedSource('https://169.254.169.254/latest')).toBe(false);
    expect(allowedSource('https://media.api-sports.io.evil.test/x.png')).toBe(false);
    expect(allowedSource('not a url')).toBe(false);
  });
});
