import { describe, expect, it } from 'vitest';
import {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  parseHistoryQuery,
} from './internal/history-query';

describe('parseHistoryQuery', () => {
  it('defaults to the first page', () => {
    expect(parseHistoryQuery({})).toEqual({
      ok: true,
      query: { limit: HISTORY_DEFAULT_LIMIT, offset: 0 },
    });
  });

  it('accepts a page inside the limits, first value of a repeat', () => {
    expect(parseHistoryQuery({ limit: ['5', '99'], offset: '40' })).toEqual({
      ok: true,
      query: { limit: 5, offset: 40 },
    });
    expect(parseHistoryQuery({ limit: String(HISTORY_MAX_LIMIT) }).ok).toBe(true);
  });

  it('names every bad field at once', () => {
    const parsed = parseHistoryQuery({ limit: '0', offset: 'x' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fields).sort()).toEqual(['limit', 'offset']);
    expect(parseHistoryQuery({ limit: String(HISTORY_MAX_LIMIT + 1) }).ok).toBe(false);
  });
});
