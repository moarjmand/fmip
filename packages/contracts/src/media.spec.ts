import { describe, expect, it } from 'vitest';
import { MEDIA_EXTENSIONS, mediaUrl, mediaVersionOf } from './media';

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
