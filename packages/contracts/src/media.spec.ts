import { describe, expect, it } from 'vitest';
import type { CountryRef } from './catalog';
import {
  MEDIA_EXTENSIONS,
  MEDIA_KINDS,
  NO_MEDIA,
  mediaSized,
  mediaUrl,
  mediaVersionOf,
  mediaWidthOf,
} from './media';

/**
 * Media addresses (T-1461): each ends in its type's extension, so the edge
 * caches it by the path alone, and the version reads back the same from an
 * address with or without one.
 */
describe('mediaUrl', () => {
  const id = '00000000-0000-4000-8000-000000000101';

  it('ends every stored type in its extension', () => {
    expect(mediaUrl('crest', id, 'abc123def456', 'image/png')).toBe(
      `/api/media/crest/${id}/abc123def456.png`,
    );
    expect(mediaUrl('photo', id, 'abc123def456', 'image/jpeg')).toBe(
      `/api/media/photo/${id}/abc123def456.jpg`,
    );
    expect(mediaUrl('logo', id, 'abc123def456', 'image/svg+xml')).toMatch(/\.svg$/);
    expect(mediaUrl('venue', id, 'abc123def456', 'image/webp')).toMatch(/\.webp$/);
    // Every extension is one Cloudflare caches by default.
    expect(Object.values(MEDIA_EXTENSIONS).sort()).toEqual(['jpg', 'png', 'svg', 'webp']);
  });

  it('reads the version back from an address with or without an extension', () => {
    expect(mediaVersionOf('abc123def456.png')).toBe('abc123def456');
    expect(mediaVersionOf('abc123def456')).toBe('abc123def456');
  });
});

describe('mediaSized (T-1462)', () => {
  const crest = '/api/media/crest/00000000-0000-4000-8000-000000000101/abc123def456.png';

  it('asks for the WebP at least twice the box, from the widths we make', () => {
    expect(mediaSized(crest, 20)).toBe(
      '/api/media/crest/00000000-0000-4000-8000-000000000101/abc123def456-48.webp',
    );
    expect(mediaSized(crest, 22)).toMatch(/-48\.webp$/);
    expect(mediaSized(crest, 40)).toMatch(/-96\.webp$/);
    expect(mediaSized(crest, 48)).toMatch(/-96\.webp$/);
    expect(mediaSized(crest, 96)).toMatch(/-192\.webp$/);
    expect(mediaSized(crest, 400)).toMatch(/-192\.webp$/);
    expect(mediaSized(crest.replace('.png', '.jpg'), 40)).toMatch(/-96\.webp$/);
  });

  it('leaves an SVG and an address without an extension as they are', () => {
    const svg = crest.replace('.png', '.svg');
    expect(mediaSized(svg, 20)).toBe(svg);
    const older = crest.replace('.png', '');
    expect(mediaSized(older, 20)).toBe(older);
  });

  it('reads a variant segment back', () => {
    expect(mediaWidthOf('abc123def456-96.webp')).toBe(96);
    expect(mediaWidthOf('abc123def456.png')).toBeNull();
    expect(mediaWidthOf('abc123def456')).toBeNull();
    expect(mediaVersionOf('abc123def456-96.webp')).toBe('abc123def456');
  });
});

describe('flags (T-1611, D-282)', () => {
  it('is a kind of its own, served like the rest', () => {
    expect(MEDIA_KINDS).toContain('flag');
    const id = '00000000-0000-4000-8000-000000000201';
    const svg = mediaUrl('flag', id, 'abc123def456', 'image/svg+xml');
    expect(svg).toBe(`/api/media/flag/${id}/abc123def456.svg`);
    // The provider draws its flags as SVG, served as stored.
    expect(mediaSized(svg, 20)).toBe(svg);
  });

  it('rides beside a country as an optional field', () => {
    const country: CountryRef = { id: 'c', name: 'England', code: 'ENG', flag: NO_MEDIA };
    const bare: CountryRef = { id: 'c', name: 'England', code: 'ENG' };
    expect(country.flag?.coverage).toBe('not_supplied');
    expect(bare.flag).toBeUndefined();
  });
});
