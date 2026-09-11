import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  QUERY_MAX_LENGTH,
  normaliseQuery,
  parseSearchQuery,
} from './internal/search-query';

describe('parseSearchQuery', () => {
  it('needs a query of at least two characters and defaults the rest', () => {
    expect(parseSearchQuery({ q: 'Man Utd' })).toEqual({
      ok: true,
      query: { q: 'Man Utd', types: ['team', 'competition', 'person'], limit: DEFAULT_LIMIT },
    });
    expect(parseSearchQuery({})).toMatchObject({ ok: false, fields: { q: expect.any(String) } });
    expect(parseSearchQuery({ q: ' x ' }).ok).toBe(false);
    expect(parseSearchQuery({ q: 'a'.repeat(QUERY_MAX_LENGTH + 1) }).ok).toBe(false);
  });

  it('collapses whitespace but leaves case and accents to the database', () => {
    expect(normaliseQuery('  Real   Madrid ')).toBe('Real Madrid');
    expect(normaliseQuery('Testović')).toBe('Testović');
  });

  it('narrows the types to a known subset, in canonical order', () => {
    expect(parseSearchQuery({ q: 'salah', types: 'person,team' })).toMatchObject({
      ok: true,
      query: { types: ['team', 'person'] },
    });
    expect(parseSearchQuery({ q: 'salah', types: 'person,match' }).ok).toBe(false);
    expect(parseSearchQuery({ q: 'salah', types: ',' }).ok).toBe(false);
  });

  it('bounds the limit and names every bad field at once', () => {
    expect(parseSearchQuery({ q: 'liv', limit: String(MAX_LIMIT) })).toMatchObject({
      ok: true,
      query: { limit: MAX_LIMIT },
    });
    const parsed = parseSearchQuery({ q: 'x', types: 'nope', limit: '0' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fields).sort()).toEqual(['limit', 'q', 'types']);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseSearchQuery({ q: ['real', 'x'] })).toMatchObject({
      ok: true,
      query: { q: 'real' },
    });
  });
});
