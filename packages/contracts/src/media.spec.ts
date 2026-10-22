import { describe, expect, it } from 'vitest';
import { mediaSized, mediaVersionOf, mediaWidthOf } from './media';

/**
 * Sized variants of a stored image (T-1462): the address a box asks for, and
 * the version and width read back from a variant's segment.
 */
describe('mediaSized', () => {
  const crest = '/api/media/crest/00000000-0000-4000-8000-000000000101/abc123def456';

  it('asks for the WebP at least twice the box, from the widths we make', () => {
    expect(mediaSized(crest, 20)).toBe(`${crest}-48.webp`);
    expect(mediaSized(crest, 22)).toBe(`${crest}-48.webp`);
    expect(mediaSized(crest, 40)).toBe(`${crest}-96.webp`);
    expect(mediaSized(crest, 48)).toBe(`${crest}-96.webp`);
    expect(mediaSized(crest, 96)).toBe(`${crest}-192.webp`);
    expect(mediaSized(crest, 400)).toBe(`${crest}-192.webp`);
  });

  it('leaves an address of another shape as it is', () => {
    expect(mediaSized('/media/news/ab/abc.jpg', 20)).toBe('/media/news/ab/abc.jpg');
    expect(mediaSized(`${crest}-48.webp`, 20)).toBe(`${crest}-48.webp`);
  });

  it('reads a variant segment back', () => {
    expect(mediaWidthOf('abc123def456-96.webp')).toBe(96);
    expect(mediaWidthOf('abc123def456')).toBeNull();
    expect(mediaVersionOf('abc123def456-96.webp')).toBe('abc123def456');
    expect(mediaVersionOf('abc123def456')).toBe('abc123def456');
  });
});
